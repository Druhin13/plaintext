"""Marked documents and the channels that damage them.

A ``MarkedDoc`` is a list of slots.  Slot ``i`` holds token ``i`` together with
the carrier marks sitting immediately *before* it, so any operation that moves,
copies or deletes slots carries the marks along automatically and there is no
alignment problem for synthetic channels.  (Real revision pairs do need
alignment; see ``align.py``.)

Boundary policy for deletions: deleting token slice ``[a, b)`` deletes slots
``a .. b-1``, which erases the marks in gaps ``a .. b-1`` and keeps the marks in
gap ``b``.  This is the pessimistic reading of a user selecting a span and
pressing delete, and it is the reading that makes the measurement conservative.

The channels fall into three families, and they stress different terms in the
cost model:

  * **block loss** (crop, fragments, sentence deletion, paragraph reorder,
    splice) removes whole regions.  Survival is bursty; block length barely
    matters.
  * **carrier thinning** (``thin``) removes individual carriers independently.
    Survival of an atomic authenticated block of length L goes as sigma**L, so
    this is the channel where block length dominates everything.
  * **context mutation** (reword, typo, recase, repunctuate) leaves the carrier
    in place but changes the visible text around it.  This is the channel that
    only exists post-hoc, and the one the whole project is about.
"""

from __future__ import annotations

import random
import re
from dataclasses import dataclass, field, replace
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
        """mark id -> gap index in the current token list."""
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
    """Attach ``per_site`` marks at each of ``gaps``.

    Mark ids are ``site_index * per_site + j`` so the site a mark belongs to is
    recoverable as ``mark_id // per_site``.  A site is all-or-nothing in the
    hard-decision design (one validation tag covers the whole cluster), which
    ``measure.py`` relies on.
    """
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


# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------

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


# --------------------------------------------------------------------------
# channels
# --------------------------------------------------------------------------

Channel = Callable[[MarkedDoc, random.Random], MarkedDoc]


def identity() -> Channel:
    def ch(md: MarkedDoc, rng: random.Random) -> MarkedDoc:
        return md.copy()
    return ch


def crop(keep_frac: float) -> Channel:
    """One contiguous excerpt of the document."""
    def ch(md: MarkedDoc, rng: random.Random) -> MarkedDoc:
        n = len(md.slots)
        span = max(1, int(round(n * keep_frac)))
        start = rng.randrange(0, max(1, n - span + 1))
        return _keep_slices(md, [(start, start + span)])
    return ch


def fragments(n_frags: int, keep_frac: float) -> Channel:
    """``n_frags`` disjoint excerpts, in original order, totalling keep_frac.

    The interesting axis is not how much survives but in how many pieces.  Two
    runs of the same total length behave identically for a coded scheme and
    very differently for a packet scheme.
    """
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
    """Remove a random subset of sentences."""
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
    """Insert unmarked foreign *runs* into the document.

    Insertion in contiguous runs, not token by token.  This matters more than
    it looks: scattering single foreign words at rate f destroys a left-sided
    context of width w with probability 1-(1-f)**w, so word-level interleaving
    annihilates every address at any realistic f.  Real splicing inserts whole
    sentences, which breaks only the w tokens that straddle each seam.  Getting
    this wrong makes insertion look like the dominant threat when it is close
    to the mildest one.

    Pure insertion: no carrier is lost and no existing token is edited.
    """
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
    """Replace a fraction of *content* tokens with other content tokens.

    Models paraphrase.  The carrier before a replaced token survives, because
    the user selected the word, not the invisible character preceding it.  So
    this channel produces surviving-but-misaddressed marks, which is precisely
    the failure mode that does not exist in generation-time watermarking.
    """
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
    """Character-level perturbation inside tokens."""
    def ch(md: MarkedDoc, rng: random.Random) -> MarkedDoc:
        out = md.copy()
        for s in out.slots:
            if len(s.token) > 3 and rng.random() < frac:
                i = rng.randrange(len(s.token))
                s.token = s.token[:i] + s.token[i + 1:]
        return out
    return ch


def recase() -> Channel:
    """Title-case every token: pure case noise, should be free under NFKC+fold."""
    def ch(md: MarkedDoc, rng: random.Random) -> MarkedDoc:
        out = md.copy()
        for s in out.slots:
            s.token = s.token.title()
        return out
    return ch


def repunctuate() -> Channel:
    """Swap quote and dash styles.  Free for ``alnum`` and above, fatal for ``raw``."""
    table = {'"': "\u201c", "'": "\u2019", "-": "\u2013", "...": "\u2026"}

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
    """Drop each carrier independently.  Models partial sanitisation.

    No visible text changes, so every surviving mark is correctly addressed.
    This isolates the block-length term: it is the channel on which a 80-carrier
    packet dies and a 30-carrier cluster does not.
    """
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
    """The channel set the pre-registered thresholds are defined against.

    The two composite channels are named ``synthA``/``synthB`` and not
    ``leak-realistic``/``leak-hostile`` on purpose.  We chose these parameters;
    nothing has yet shown they resemble how documents are actually excerpted
    and redistributed.  Calling an invented distribution "realistic" and then
    pre-registering a pass mark against it is setting our own exam.  The names
    stay neutral until the parameters are calibrated against plagiarism or
    quotation corpora, and the kill criterion is stated over a parameter
    surface rather than over one cell (see PREREGISTRATION.md C4).
    """
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
