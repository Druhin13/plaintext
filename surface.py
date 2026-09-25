"""Parameter surface: fragmentation x edit rate x thinning.

C4 is evaluated over this grid, not over one hand-picked composite channel.
Reports, for each cell, which architecture is cheapest and by how much, so the
result is a boundary map instead of a single score on an exam we wrote.
"""

import sys
sys.path.insert(0, "src")

import random
from cauf.anchors import AnchorSpec
from cauf.channels import compose, fragments, reword, thin
from cauf.corpora import load_dir_docs, sample_dir, vocabulary
from cauf.measure import Tally, measure_one, stable_seed
from cauf.model import (Carrier, Damage, Payload, Security, compare, feasible)
from cauf.text import ContextSpec

KEY = b"cauf-stability-experiment-key-do-not-use-in-production"
DOCS = load_dir_docs(sample_dir())
VOCAB = vocabulary(DOCS)
SPEC = AnchorSpec(density=20, ctx=ContextSpec(width=8, canon="skeleton"))

print(f"{'frags':>6}{'keep':>6}{'reword':>8}{'thin':>7}"
      f"{'sigma':>8}{'q':>7}{'rank%':>7}  {'cheapest':<24}{'chars':>8}{'vs packet':>11}")
print("-" * 100)
for n_frag in (1, 3, 10):
    for keep in (0.6, 0.35):
        for rw in (0.0, 0.10, 0.25):
            # `th` is deliberately NOT in the RNG seed.  Thinning is applied
            # analytically in Damage, so the thin=0 and thin=2% rows must
            # price the SAME damaged visible document.  Seeding on `th` gave
            # them different fragmentation and rewording realisations and
            # confounded the comparison.  Found in external review, round two.
            for th in (0.0, 0.02):
                t = Tally()
                # Thinning must NOT go in the channel here.  The harness would
                # record it as plain carrier loss, whereas its whole
                # significance is that it enters block survival as
                # (1-r)**block_length.  It belongs in Damage.thin_rate.
                ch = compose(fragments(n_frag, keep), reword(VOCAB, rw))
                for i, doc in enumerate(DOCS):
                    t.add(measure_one(doc, KEY, SPEC, ch,
                                      random.Random(stable_seed(n_frag, keep, rw, i))))
                sec = Security(density_D=20, n_anchor_sites=400)
                pl = Payload(k_id=128, tau=32)
                dmg = Damage(sigma_block=t.sigma_block, q=t.q, thin_rate=th)
                designs = compare(pl, Carrier(), sec, dmg, c=8, seed_bits=10, words=5000)
                priced = {k: v for k, v in designs.items()
                          if v.total_chars is not None and "BOUND" not in v.name
                          and feasible(v, 5000, sec, t.collision_rate)}
                packet = min((v.total_chars for k, v in designs.items()
                              if k in ("monolithic", "indexed") and v.total_chars),
                             default=None)
                if not priced:
                    print(f"{n_frag:>6}{keep:>6}{rw:>8}{th:>7}"
                          f"{t.sigma_block:>8.2f}{t.q:>7.2f}{t.rank_fraction:>7.2f}  "
                          f"{'none feasible':<24}")
                    continue
                name, best = min(priced.items(), key=lambda kv: kv[1].total_chars)
                ratio = packet / best.total_chars if packet else float("nan")
                print(f"{n_frag:>6}{keep:>6}{rw:>8}{th:>7}"
                      f"{t.sigma_block:>8.2f}{t.q:>7.2f}{t.rank_fraction:>7.2f}  "
                      f"{name:<24}{best.total_chars:>8.0f}{ratio:>10.2f}x")
