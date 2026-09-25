"""Keyed content-defined anchor selection.

The anchor predicate and the address are computed from *the same* canonical
context.  That coupling is not incidental: it is what gives the scheme its free
suppression of misaddressing.  If the surrounding text is edited, the context
changes, and a changed context re-satisfies the predicate only with probability
1/D.  So a context-change rate of ``1 - q`` becomes a misaddressing rate of
roughly ``(1 - q)/D`` among accepted marks, before any validation bits are
spent.  MODEL.md section 8 works this through.

Using two different windows for "where to mark" and "which equation" would
throw that away, so the API does not permit it.
"""

from __future__ import annotations

import hmac
from dataclasses import dataclass
from hashlib import blake2b, sha256
from typing import Iterator, List, Sequence

from .text import ContextSpec, Doc


def prf(key: bytes, *parts: bytes) -> bytes:
    """Keyed PRF over a tuple of byte strings, with length framing.

    Framing matters: without it, ``("ab", "c")`` and ``("a", "bc")`` collide,
    which would silently merge distinct addresses.
    """
    h = hmac.new(key, digestmod=sha256)
    for p in parts:
        h.update(len(p).to_bytes(4, "big"))
        h.update(p)
    return h.digest()


def anchor_value(key: bytes, context: bytes) -> int:
    """Uniform 64-bit value used for the mod-D anchor test."""
    return int.from_bytes(
        blake2b(context, key=key[:64], digest_size=8).digest(), "big"
    )


@dataclass(frozen=True)
class AnchorSpec:
    """Anchor selection parameters.

    ``density`` is D: one gap in D is expected to be an anchor.  D trades three
    things against each other and MODEL.md prices all three:

      * anchor supply      (falls as 1/D)
      * misaddress rate    (falls as 1/D)
      * contamination rate (falls as 1/D)
    """

    density: int
    ctx: ContextSpec

    def fires(self, key: bytes, context: bytes) -> bool:
        return anchor_value(key, context) % self.density == 0

    def label(self) -> str:
        return f"D{self.density}:{self.ctx.label()}"


@dataclass
class Site:
    """An accepted anchor site in a document."""

    gap: int
    context: bytes

    @property
    def digest(self) -> str:
        return sha256(self.context).hexdigest()[:16]


def find_sites(doc: Doc, key: bytes, spec: AnchorSpec) -> List[Site]:
    """All gaps whose canonical context satisfies the keyed anchor predicate."""
    sites: List[Site] = []
    toks = doc.tokens
    for gap in range(doc.n_gaps):
        ctx = spec.ctx.context_at(toks, gap)
        if ctx is None:
            continue
        if spec.fires(key, ctx):
            sites.append(Site(gap=gap, context=ctx))
    return sites


def site_at(tokens: Sequence[str], gap: int, key: bytes,
            spec: AnchorSpec) -> Site | None:
    """Re-evaluate the predicate at one gap.  Used by the decoder side."""
    ctx = spec.ctx.context_at(tokens, gap)
    if ctx is None or not spec.fires(key, ctx):
        return None
    return Site(gap=gap, context=ctx)


def collision_stats(sites: Sequence[Site]) -> tuple[int, int, float]:
    """(n_sites, n_distinct_contexts, wasted_fraction).

    Two anchors with an identical canonical context generate an identical
    coefficient vector, so the second carries no new information.  Boilerplate,
    table rows, repeated headings and short windows all produce these.  The
    wasted fraction is a direct multiplier on required overhead and does not
    appear anywhere in the existing literature.
    """
    n = len(sites)
    if n == 0:
        return 0, 0, 0.0
    distinct = len({s.context for s in sites})
    return n, distinct, 1.0 - distinct / n


def context_entropy_bits(sites: Sequence[Site]) -> float:
    """Empirical Shannon entropy of the address distribution, in bits.

    An upper bound on how many independent equations a document can host with
    this context specification, regardless of how many anchors fire.
    """
    if not sites:
        return 0.0
    from collections import Counter
    import math

    counts = Counter(s.context for s in sites)
    n = len(sites)
    return -sum((c / n) * math.log2(c / n) for c in counts.values())


def iter_gaps_with_tokens(doc: Doc) -> Iterator[tuple[int, str | None]]:
    for gap in range(doc.n_gaps):
        yield gap, doc.tokens[gap] if gap < len(doc.tokens) else None


def coefficient_vector(key: bytes, context: bytes, j: int, k: int,
                       sparse_degree: int = 0) -> int:
    """The k-bit coefficient vector an address generates, as a bitset.

    ``sparse_degree = 0`` gives a dense uniform vector, which has the best rank
    behaviour and is what the hard-decision (validate-and-erase) path should
    use.  A positive degree gives an LDPC-style sparse vector, which is what a
    belief-propagation decoder needs but which reaches full rank more slowly.
    Being able to measure both is the point: the soft path's feasibility rests
    on sparsity, and sparsity costs rank.
    """
    if sparse_degree > 0:
        v, i = 0, 0
        chosen: set[int] = set()
        while len(chosen) < min(sparse_degree, k):
            blk = prf(key, context, j.to_bytes(4, "big"), i.to_bytes(4, "big"))
            for b in range(0, len(blk) - 1, 2):
                chosen.add(int.from_bytes(blk[b:b + 2], "big") % k)
                if len(chosen) >= min(sparse_degree, k):
                    break
            i += 1
        for pos in chosen:
            v |= 1 << pos
        return v
    out, got, ctr = 0, 0, 0
    while got < k:
        blk = prf(key, context, j.to_bytes(4, "big"), ctr.to_bytes(4, "big"))
        out |= int.from_bytes(blk, "big") << got
        got += 8 * len(blk)
        ctr += 1
    return out & ((1 << k) - 1)


def gf2_rank(vectors: Sequence[int]) -> int:
    """Rank over GF(2) of bitset rows, by elimination on pivot positions."""
    pivots: dict[int, int] = {}
    rank = 0
    for v in vectors:
        while v:
            high = v.bit_length() - 1
            if high in pivots:
                v ^= pivots[high]
            else:
                pivots[high] = v
                rank += 1
                break
    return rank
