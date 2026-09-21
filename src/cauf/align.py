"""Measuring against *real* edit pairs.

Synthetic channels carry marks along with the text, so there is nothing to
align.  Real revision pairs (Wikipedia, arXiv v1/v2) are two independent
strings, so we have to decide where a mark placed in the original would end up
in the revision.  ``difflib.SequenceMatcher`` over token sequences gives the
matching blocks; a mark in a matched block maps across, a mark inside a
replaced or deleted region is treated as lost.
"""

from __future__ import annotations

from dataclasses import dataclass
from difflib import SequenceMatcher
from typing import Dict, List, Sequence

from .anchors import AnchorSpec, find_sites, site_at
from .measure import Tally
from .text import parse


def gap_map(src: Sequence[str], dst: Sequence[str]) -> Dict[int, int]:
    sm = SequenceMatcher(a=list(src), b=list(dst), autojunk=False)
    out: Dict[int, int] = {}
    for a, b, size in sm.get_matching_blocks():
        for k in range(size + 1):
            g = a + k
            if g not in out:
                out[g] = b + k
    return out


@dataclass
class Pair:
    before: str
    after: str
    pair_id: str = ""


def measure_pair(pair: Pair, key: bytes, spec: AnchorSpec) -> Tally:
    d0 = parse(pair.before, pair.pair_id)
    d1 = parse(pair.after, pair.pair_id)
    sites = find_sites(d0, key, spec)
    t = Tally(n_docs=1, tokens=len(d0), anchors=len(sites))
    if not sites:
        return t
    from .anchors import collision_stats, context_entropy_bits
    n, distinct, _ = collision_stats(sites)
    t.duplicate_addresses = n - distinct
    t.entropy_bits = context_entropy_bits(sites)

    gm = gap_map(d0.tokens, d1.tokens)
    t.placed = len(sites)
    for s in sites:
        g1 = gm.get(s.gap)
        if g1 is None:
            t.lost += 1
            continue
        t.survived += 1
        ctx_now = spec.ctx.context_at(d1.tokens, g1)
        changed = ctx_now != s.context
        if changed:
            t.survived_ctx_changed += 1
        if site_at(d1.tokens, g1, key, spec) is None:
            t.no_anchor += 1
        elif changed:
            t.misaddressed += 1
        else:
            t.exact += 1
    return t


def measure_pairs(pairs: Sequence[Pair], key: bytes,
                  specs: Sequence[AnchorSpec]) -> Dict[str, Tally]:
    out: Dict[str, Tally] = {}
    for spec in specs:
        agg = Tally()
        for p in pairs:
            agg.add(measure_pair(p, key, spec))
        out[spec.label()] = agg
    return out


def edit_magnitude(pair: Pair) -> float:
    a, b = parse(pair.before).tokens, parse(pair.after).tokens
    if not a:
        return 1.0
    sm = SequenceMatcher(a=a, b=b, autojunk=False)
    matched = sum(bl.size for bl in sm.get_matching_blocks())
    return 1.0 - matched / max(len(a), len(b))


def bin_pairs(pairs: Sequence[Pair],
              edges: Sequence[float] = (0.0, 0.02, 0.05, 0.10, 0.25, 1.01),
              ) -> Dict[str, List[Pair]]:
    out: Dict[str, List[Pair]] = {}
    for p in pairs:
        m = edit_magnitude(p)
        for lo, hi in zip(edges, edges[1:]):
            if lo <= m < hi:
                out.setdefault(f"edit[{lo:.2f},{hi:.2f})", []).append(p)
                break
    return out
