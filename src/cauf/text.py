"""Tokenization and context canonicalisation.

A document is a flat list of whitespace-delimited tokens plus a paragraph index
per token.  Carrier marks live in *gaps*: gap ``i`` sits immediately before
token ``i``, so a document with ``n`` tokens has ``n + 1`` gaps.

A *canonicaliser* maps a window of tokens to a byte string.  This string is the
address: the equation coefficients and (in the hard-decision design) the
validation tag are both derived from it.  Everything about how robust the
scheme is to editing is decided here, so canonicalisers are the primary
independent variable of the stability experiment.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field
from typing import Callable, List, Sequence

# Carrier code points.  ZWNJ/ZWJ are the renderer-safe binary pair: invisible in
# Word, Google Docs, browsers and chat.  U+200B is deliberately excluded (Word
# strips it on paste) and variation selectors are excluded (they render as tofu
# in Word/Docs).  The INVISIBLE_OPERATORS set is an alternative carrier class,
# useful because it is disjoint from what other zero-width watermarks use, which
# matters for the contamination analysis in MODEL.md section 9.
ZWNJ = "\u200c"
ZWJ = "\u200d"
BINARY_CARRIER = (ZWNJ, ZWJ)
INVISIBLE_OPERATORS = ("\u2061", "\u2062", "\u2063", "\u2064")

_TOKEN_RE = re.compile(r"\S+")
_ALNUM_RE = re.compile(r"[^0-9a-z]+")

# Closed-class words.  The skeleton canonicaliser keeps only these, on the
# theory that paraphrase replaces content words far more often than function
# words, so a skeleton address should survive rewording that a literal one does
# not.  Whether that is actually true is exactly what we are measuring.
FUNCTION_WORDS = frozenset("""
a about above after again against all am an and any are as at be because been
before being below between both but by can cannot could did do does doing down
during each few for from further had has have having he her here hers herself
him himself his how i if in into is it its itself just me more most my myself
no nor not now of off on once only or other our ours ourselves out over own
same she should so some such than that the their theirs them themselves then
there these they this those through to too under until up very was we were
what when where which while who whom why will with would you your yours
yourself yourselves
""".split())

_SUFFIXES = ("ational", "tional", "iveness", "fulness", "ousness", "ization",
             "ation", "ement", "ments", "ness", "ing", "ies", "ed", "ly",
             "es", "s")


def light_stem(word: str) -> str:
    """Cheap suffix stripping.  Not Porter; deliberately dependency-free.

    Correctness matters less than determinism: encoder and decoder must agree,
    and the only question the experiment asks is whether stemming raises the
    survival rate of the address.
    """
    for suf in _SUFFIXES:
        if len(word) > len(suf) + 2 and word.endswith(suf):
            return word[: -len(suf)]
    return word


@dataclass
class Doc:
    """A tokenised document."""

    tokens: List[str]
    para_of: List[int]
    doc_id: str = ""

    def __post_init__(self) -> None:
        if len(self.tokens) != len(self.para_of):
            raise ValueError("tokens and para_of must be the same length")

    @property
    def n_gaps(self) -> int:
        return len(self.tokens) + 1

    def __len__(self) -> int:
        return len(self.tokens)


def parse(text: str, doc_id: str = "") -> Doc:
    """Tokenise raw text, tracking paragraph membership."""
    tokens: List[str] = []
    para_of: List[int] = []
    for p_idx, para in enumerate(re.split(r"\n\s*\n", text)):
        for m in _TOKEN_RE.finditer(para):
            tokens.append(m.group(0))
            para_of.append(p_idx)
    return Doc(tokens=tokens, para_of=para_of, doc_id=doc_id)


# --------------------------------------------------------------------------
# Canonicalisers.  Each takes a token window and returns bytes.
# --------------------------------------------------------------------------

Canonicaliser = Callable[[Sequence[str]], bytes]


def _nfkc_lower(tok: str) -> str:
    return unicodedata.normalize("NFKC", tok).casefold()


def canon_raw(window: Sequence[str]) -> bytes:
    """NFKC + casefold only.  Punctuation and inflection are significant."""
    return " ".join(_nfkc_lower(t) for t in window).encode("utf-8")


def canon_alnum(window: Sequence[str]) -> bytes:
    """Strip everything but lowercase alphanumerics.  Reflow- and
    punctuation-insensitive, which is what Glyphmark's normalisation does."""
    parts = [_ALNUM_RE.sub("", _nfkc_lower(t)) for t in window]
    return " ".join(p for p in parts if p).encode("utf-8")


def canon_stem(window: Sequence[str]) -> bytes:
    """canon_alnum plus light stemming: survives tense/number changes."""
    parts = [light_stem(_ALNUM_RE.sub("", _nfkc_lower(t))) for t in window]
    return " ".join(p for p in parts if p).encode("utf-8")


def canon_skeleton(window: Sequence[str]) -> bytes:
    """Function words in order; content words collapse to a length bucket.

    Keeps syntactic shape while discarding the lexical choices a paraphraser is
    most likely to change.  Length bucketing retains a little content signal so
    the address does not collapse to a handful of distinct values.
    """
    out: List[str] = []
    for t in window:
        w = _ALNUM_RE.sub("", _nfkc_lower(t))
        if not w:
            continue
        if w in FUNCTION_WORDS:
            out.append(w)
        else:
            out.append("#%d" % min(len(w) // 3, 4))
    return " ".join(out).encode("utf-8")


def canon_initials(window: Sequence[str]) -> bytes:
    """First letter of each token.  Maximum edit tolerance, minimum entropy.

    Included as the low-entropy end of the range: it should show the highest
    survival rate and the highest collision rate, bracketing the trade-off.
    """
    out = []
    for t in window:
        w = _ALNUM_RE.sub("", _nfkc_lower(t))
        if w:
            out.append(w[0])
    return "".join(out).encode("utf-8")


CANONICALISERS: dict[str, Canonicaliser] = {
    "raw": canon_raw,
    "alnum": canon_alnum,
    "stem": canon_stem,
    "skeleton": canon_skeleton,
    "initials": canon_initials,
}


def window_tokens(tokens: Sequence[str], gap: int, width: int,
                  side: str = "left") -> List[str] | None:
    """Tokens forming the context of ``gap``.

    ``side='left'``  : the ``width`` tokens before the gap.
    ``side='sym'``   : ``width // 2`` either side.

    Returns ``None`` when the window would run off the end of the document,
    which makes those gaps ineligible as anchors for both encoder and decoder.
    Left-sided windows are the interesting default: an insertion *after* the
    mark cannot disturb the address, so the two sides are not symmetric in
    robustness.
    """
    n = len(tokens)
    if side == "left":
        if gap - width < 0:
            return None
        return list(tokens[gap - width:gap])
    if side == "sym":
        half = width // 2
        if gap - half < 0 or gap + half > n:
            return None
        return list(tokens[gap - half:gap + half])
    raise ValueError("side must be 'left' or 'sym'")


@dataclass
class ContextSpec:
    """A full address definition: how wide, which side, which canonicaliser."""

    width: int
    canon: str = "alnum"
    side: str = "left"

    @property
    def fn(self) -> Canonicaliser:
        return CANONICALISERS[self.canon]

    def context_at(self, tokens: Sequence[str], gap: int) -> bytes | None:
        win = window_tokens(tokens, gap, self.width, self.side)
        if win is None:
            return None
        return self.fn(win)

    def label(self) -> str:
        return f"{self.canon}/w{self.width}/{self.side}"
