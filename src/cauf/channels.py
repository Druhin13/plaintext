"""Marked documents and the channels that damage them."""

from __future__ import annotations

import random
import re
from dataclasses import dataclass, field
from typing import Callable, Dict, List, Sequence

from .text import FUNCTION_WORDS, Doc

_SENT_END = re.compile(r"[.!?][\"')\]]*$")


@dataclass
class Slot:
    marks: List[int]
    token: str
    para: int


@dataclass
class MarkedDoc:
    slots: List[Slot]
    tail_marks: List[int] = field(default_factory=list)
    doc_id: str = ""

    @property
    def tokens(self) -> List[str]:
        return [s.token for s in self.slots]

    def gap_of_marks(self) -> Dict[int, int]:
        out: Dict[int, int] = {}
        for i, slot in enumerate(self.slots):
            for m in slot.marks:
                out[m] = i
        for m in self.tail_marks:
            out[m] = len(self.slots)
        return out

    def n_marks(self) -> int:
        return sum(len(s.marks) for s in self.slots) + len(self.tail_marks)

    def copy(self) -> "MarkedDoc":
        return MarkedDoc(
            slots=[Slot(list(s.marks), s.token, s.para) for s in self.slots],
            tail_marks=list(self.tail_marks),
            doc_id=self.doc_id,
        )


def place(doc: Doc, gaps: Sequence[int], per_site: int = 1) -> MarkedDoc:
    slots = [Slot([], t, p) for t, p in zip(doc.tokens, doc.para_of)]
    md = MarkedDoc(slots=slots, doc_id=doc.doc_id)
    n = len(doc.tokens)
    for site_idx, gap in enumerate(gaps):
        ids = [site_idx * per_site + j for j in range(per_site)]
        if gap < n:
            md.slots[gap].marks.extend(ids)
        else:
            md.tail_marks.extend(ids)
    return md


def _sentence_spans(md: MarkedDoc) -> List[tuple[int, int]]:
    spans, start = [], 0
    for i, slot in enumerate(md.slots):
        if _SENT_END.search(slot.token):
            spans.append((start, i + 1))
            start = i + 1
    if start < len(md.slots):
        spans.append((start, len(md.slots)))
    return spans


def _paragraph_spans(md: MarkedDoc) -> List[tuple[int, int]]:
    spans, start = [], 0
    for i in range(1, len(md.slots) + 1):
        if i == len(md.slots) or md.slots[i].para != md.slots[start].para:
            spans.append((start, i))
            start = i
    return spans


def _keep_slices(md: MarkedDoc, slices: Sequence[tuple[int, int]]) -> MarkedDoc:
    out: List[Slot] = []
    for a, b in slices:
        out.extend(Slot(list(s.marks), s.token, s.para)
                   for s in md.slots[a:b])
    tail = md.tail_marks if slices and slices[-1][1] == len(md.slots) else []
    return MarkedDoc(slots=out, tail_marks=list(tail), doc_id=md.doc_id)


Channel = Callable[[MarkedDoc, random.Random], MarkedDoc]


def identity() -> Channel:
    def ch(md: MarkedDoc, rng: random.Random) -> MarkedDoc:
        return md.copy()
    return ch


def crop(keep_frac: float) -> Channel:
    def ch(md: MarkedDoc, rng: random.Random) -> MarkedDoc:
        n = len(md.slots)
        span = max(1, int(round(n * keep_frac)))
        start = rng.randrange(0, max(1, n - span + 1))
        return _keep_slices(md, [(start, start + span)])
    return ch


def fragments(n_frags: int, keep_frac: float) -> Channel:
    def ch(md: MarkedDoc, rng: random.Random) -> MarkedDoc:
        n = len(md.slots)
        total = max(n_frags, int(round(n * keep_frac)))
        per = max(1, total // n_frags)
        starts = sorted(rng.sample(range(0, max(1, n - per)), k=min(n_frags, max(1, n - per))))
        slices, last_end = [], -1
        for s in starts:
            a = max(s, last_end)
            b = min(n, a + per)
            if b > a:
                slices.append((a, b))
                last_end = b
        return _keep_slices(md, slices or [(0, min(n, per))])
    return ch


def delete_sentences(frac: float) -> Channel:
    def ch(md: MarkedDoc, rng: random.Random) -> MarkedDoc:
        spans = _sentence_spans(md)
        keep = [s for s in spans if rng.random() >= frac]
        return _keep_slices(md, keep or spans[:1])
    return ch


def reorder_paragraphs() -> Channel:
    def ch(md: MarkedDoc, rng: random.Random) -> MarkedDoc:
        spans = _paragraph_spans(md)
        order = list(range(len(spans)))
        rng.shuffle(order)
        return _keep_slices(md, [spans[i] for i in order])
    return ch


def splice_foreign(foreign: Sequence[str], frac: float,
                   run: int = 20) -> Channel:
    def ch(md: MarkedDoc, rng: random.Random) -> MarkedDoc:
        n = len(md.slots)
        if not foreign or n == 0:
            return md.copy()
        n_ins = int(round(n * frac))
        n_runs = max(1, n_ins // max(1, run))
        seams = sorted(rng.sample(range(n), k=min(n_runs, n)))
        out: List[Slot] = []
        seam_set = set(seams)
        for i, s in enumerate(md.slots):
            if i in seam_set:
                start = rng.randrange(len(foreign))
                for k in range(run):
                    out.append(Slot([], foreign[(start + k) % len(foreign)], -1))
            out.append(Slot(list(s.marks), s.token, s.para))
        return MarkedDoc(slots=out, tail_marks=list(md.tail_marks), doc_id=md.doc_id)
    return ch


def reword(vocab: Sequence[str], frac: float) -> Channel:
    pool = [w for w in vocab if w.lower() not in FUNCTION_WORDS] or list(vocab)

    def ch(md: MarkedDoc, rng: random.Random) -> MarkedDoc:
        out = md.copy()
        for s in out.slots:
            if s.token.lower() in FUNCTION_WORDS:
                continue
            if rng.random() < frac:
                s.token = pool[rng.randrange(len(pool))]
        return out
    return ch


def typo(frac: float) -> Channel:
    def ch(md: MarkedDoc, rng: random.Random) -> MarkedDoc:
        out = md.copy()
        for s in out.slots:
            if len(s.token) > 3 and rng.random() < frac:
                i = rng.randrange(len(s.token))
                s.token = s.token[:i] + s.token[i + 1:]
        return out
    return ch


def recase() -> Channel:
    def ch(md: MarkedDoc, rng: random.Random) -> MarkedDoc:
        out = md.copy()
        for s in out.slots:
            s.token = s.token.title()
        return out
    return ch


def repunctuate() -> Channel:
    table = {'"': "“", "'": "’", "-": "–", "...": "…"}

    def ch(md: MarkedDoc, rng: random.Random) -> MarkedDoc:
        out = md.copy()
        for s in out.slots:
            t = s.token
            for a, b in table.items():
                t = t.replace(a, b)
            s.token = t
        return out
    return ch


def thin(rate: float) -> Channel:
    def ch(md: MarkedDoc, rng: random.Random) -> MarkedDoc:
        out = md.copy()
        for s in out.slots:
            s.marks = [m for m in s.marks if rng.random() >= rate]
        out.tail_marks = [m for m in out.tail_marks if rng.random() >= rate]
        return out
    return ch


def compose(*chs: Channel) -> Channel:
    def ch(md: MarkedDoc, rng: random.Random) -> MarkedDoc:
        for c in chs:
            md = c(md, rng)
        return md
    return ch


def standard_suite(vocab: Sequence[str], foreign: Sequence[str]) -> Dict[str, Channel]:
    return {
        "clean": identity(),
        "recase": recase(),
        "repunctuate": repunctuate(),
        "crop-50": crop(0.50),
        "crop-20": crop(0.20),
        "frag-5x-30": fragments(5, 0.30),
        "frag-20x-30": fragments(20, 0.30),
        "delsent-20": delete_sentences(0.20),
        "delsent-50": delete_sentences(0.50),
        "reorder-paras": reorder_paragraphs(),
        "splice-30": splice_foreign(foreign, 0.30),
        "reword-05": reword(vocab, 0.05),
        "reword-10": reword(vocab, 0.10),
        "reword-25": reword(vocab, 0.25),
        "typo-05": typo(0.05),
        "thin-01": thin(0.01),
        "thin-10": thin(0.10),
        "synthA-frag3-rw10-sp20": compose(
            fragments(3, 0.35), reword(vocab, 0.10), splice_foreign(foreign, 0.20)
        ),
        "synthB-frag10-rw25-ty5-th5": compose(
            fragments(10, 0.25), reword(vocab, 0.25), typo(0.05), thin(0.05)
        ),
    }
