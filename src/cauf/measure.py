"""The context-stability measurement."""

from __future__ import annotations

import random
from hashlib import blake2b
from dataclasses import dataclass, asdict
from typing import Dict, List, Sequence

from .anchors import (AnchorSpec, Site, coefficient_vector, collision_stats,
                      context_entropy_bits, find_sites, gf2_rank, site_at)
from .channels import Channel, MarkedDoc, place
from .text import Doc


def stable_seed(*parts: object) -> int:
    h = blake2b(digest_size=8)
    for part in parts:
        h.update(repr(part).encode("utf-8"))
        h.update(b"\x00")
    return int.from_bytes(h.digest(), "big")


EXACT = "exact"
MISADDRESSED = "misaddressed"
NO_ANCHOR = "no_anchor"
LOST = "lost"
OUTCOMES = (EXACT, MISADDRESSED, NO_ANCHOR, LOST)


@dataclass
class Tally:
    placed: int = 0
    exact: int = 0
    misaddressed: int = 0
    no_anchor: int = 0
    lost: int = 0
    survived_ctx_changed: int = 0
    survived: int = 0
    duplicate_addresses: int = 0
    anchors: int = 0
    tokens: int = 0
    entropy_bits: float = 0.0
    rank_achieved: int = 0
    rank_ceiling: int = 0
    n_docs: int = 0

    def add(self, other: "Tally") -> None:
        for k, v in asdict(other).items():
            setattr(self, k, getattr(self, k) + v)

    @property
    def sigma_block(self) -> float:
        return self.survived / self.placed if self.placed else 0.0

    @property
    def q(self) -> float:
        if not self.survived:
            return 0.0
        return (self.survived - self.survived_ctx_changed) / self.survived

    @property
    def refire(self) -> float:
        if not self.survived_ctx_changed:
            return 0.0
        return self.misaddressed / self.survived_ctx_changed

    @property
    def yield_exact(self) -> float:
        return self.exact / self.placed if self.placed else 0.0

    @property
    def misaddress_rate(self) -> float:
        acc = self.exact + self.misaddressed
        return self.misaddressed / acc if acc else 0.0

    @property
    def p_bsc(self) -> float:
        return 0.5 * self.misaddress_rate

    @property
    def accept_rate(self) -> float:
        acc = self.exact + self.misaddressed
        return acc / self.placed if self.placed else 0.0

    @property
    def rank_fraction(self) -> float:
        return self.rank_achieved / self.rank_ceiling if self.rank_ceiling else 0.0

    @property
    def anchor_density(self) -> float:
        return 100.0 * self.anchors / self.tokens if self.tokens else 0.0

    @property
    def collision_rate(self) -> float:
        return self.duplicate_addresses / self.anchors if self.anchors else 0.0

    def summary(self) -> Dict[str, float]:
        return {
            "placed": self.placed,
            "sigma_block": round(self.sigma_block, 4),
            "q": round(self.q, 4),
            "refire": round(self.refire, 4),
            "yield_exact": round(self.yield_exact, 4),
            "misaddr_rate": round(self.misaddress_rate, 5),
            "p_bsc": round(self.p_bsc, 5),
            "accept_rate": round(self.accept_rate, 4),
            "anchor_density_per100": round(self.anchor_density, 3),
            "collision_rate": round(self.collision_rate, 4),
            "entropy_bits": round(self.entropy_bits / max(1, self.n_docs), 2),
            "rank_fraction": round(self.rank_fraction, 4),
        }


def measure_one(doc: Doc, key: bytes, spec: AnchorSpec, channel: Channel,
                rng: random.Random, per_site: int = 1,
                payload_bits: int = 80, sparse_degree: int = 0) -> Tally:
    sites = find_sites(doc, key, spec)
    t = Tally(n_docs=1, tokens=len(doc), anchors=len(sites))
    if not sites:
        return t

    n_sites, n_distinct, _ = collision_stats(sites)
    t.duplicate_addresses = n_sites - n_distinct
    t.entropy_bits = context_entropy_bits(sites)

    md: MarkedDoc = place(doc, [s.gap for s in sites], per_site=per_site)
    original_ctx = {}
    for site_idx, s in enumerate(sites):
        for j in range(per_site):
            original_ctx[site_idx * per_site + j] = s.context
    t.placed = len(original_ctx)

    surviving_ctx: List[tuple[bytes, int]] = []
    damaged = channel(md, rng)
    gaps = damaged.gap_of_marks()
    toks = damaged.tokens

    for mark_id, ctx0 in original_ctx.items():
        gap = gaps.get(mark_id)
        if gap is None:
            t.lost += 1
            continue
        t.survived += 1
        found: Site | None = site_at(toks, gap, key, spec)
        ctx_now = spec.ctx.context_at(toks, gap)
        changed = ctx_now != ctx0
        if changed:
            t.survived_ctx_changed += 1
        if found is None:
            t.no_anchor += 1
        elif changed:
            t.misaddressed += 1
        else:
            t.exact += 1
            surviving_ctx.append((ctx0, mark_id % per_site))

    vectors = [coefficient_vector(key, ctx, j, payload_bits, sparse_degree)
               for ctx, j in surviving_ctx]
    t.rank_achieved = gf2_rank(vectors)
    t.rank_ceiling = min(payload_bits, len(vectors))
    return t


def measure(docs: Sequence[Doc], key: bytes, specs: Sequence[AnchorSpec],
            channels: Dict[str, Channel], seed: int = 0,
            per_site: int = 1) -> Dict[tuple[str, str], Tally]:
    out: Dict[tuple[str, str], Tally] = {}
    for spec in specs:
        for name, ch in channels.items():
            agg = Tally()
            for i, doc in enumerate(docs):
                rng = random.Random(stable_seed(seed, spec.label(), name, i))
                agg.add(measure_one(doc, key, spec, ch, rng, per_site=per_site))
            out[(spec.label(), name)] = agg
    return out


def to_rows(results: Dict[tuple[str, str], Tally]) -> List[Dict[str, object]]:
    rows = []
    for (spec, chan), t in results.items():
        row: Dict[str, object] = {"spec": spec, "channel": chan}
        row.update(t.summary())
        rows.append(row)
    return rows


def write_csv(rows: Sequence[Dict[str, object]], path: str) -> None:
    import csv
    if not rows:
        return
    keys = list(rows[0].keys())
    with open(path, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=keys)
        w.writeheader()
        w.writerows(rows)
