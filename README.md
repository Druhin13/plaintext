# cauf-stability

Milestone 1 for context-addressed rateless fingerprinting of existing text.

Nothing here embeds or decodes a fingerprint. The purpose is to settle, before
an encoder is written, whether an address derived from mutable cover text
survives realistic editing well enough to be worth using — and, if it does not,
to say so early and cheaply.

Two deliverables:

- **`MODEL.md`** — the overhead model. Closed forms for the break-even address
  survival `q*`, the optimal block size under carrier thinning, payload
  scaling for the three architectures, and the contamination limits. Every
  formula is implemented in `src/cauf/model.py` and cross-checked against
  brute force in the tests.
- **the harness** — measures the one quantity the model cannot supply: how
  often a keyed content-defined address survives real editing intact.

`PREREGISTRATION.md` fixes the thresholds, dated, before real data.

## Install and run

```bash
pip install -e .            # or just: export PYTHONPATH=src
pip install scipy           # optional; exact binomial tails instead of normal
python3 -m pytest tests/ -q # 37 tests
python3 surface.py          # the boundary map C4 is evaluated over
python3 sweeps.py           # every number quoted in MODEL.md
```

```bash
# synthetic-channel sweep over the bundled sample
python3 -m cauf stability --widths 2,4,8,16,32 \
    --canons alnum,stem,skeleton,initials --densities 20 --out results.csv

# real revision pairs (needs network once; caches for offline replay)
python3 -m cauf pairs --wikipedia "Photosynthesis,Bauhaus,Nile" --cache .wikicache

# price the designs under a given damage model
python3 -m cauf model --sigma 0.3 --q 0.6 --thin 0.01 --words 5000

# apply the model to measured rates, row by row
python3 -m cauf decide --results results.csv --words 5000 --thin 0.01
```

## What it measures

One carrier is placed at every accepted anchor, the document is damaged, and
each carrier is reclassified:

| outcome | meaning | consequence |
|---|---|---|
| `lost` | carrier gone | erasure, safe |
| `no_anchor` | survived, predicate no longer fires | erasure, safe, free |
| `exact` | survived, fires, address identical | usable |
| `misaddressed` | survived, fires, address **changed** | wrong equation |

`misaddressed` is the only dangerous outcome and the only one with no analogue
in generation-time watermarking. The anchor predicate and the address are
computed from the *same* canonical context deliberately: a mutated context has
to re-satisfy the keyed predicate to be accepted at all, which suppresses
misaddressing by a factor of roughly `D` for free. The harness measures that
suppression (`refire`) rather than assuming it.

## Findings from the bundled sample

Six short documents. Enough to validate the code, not enough to conclude
anything. Reported because the *shape* is already informative.

Address survival `q` under 10% rewording, by canonicaliser and window width:

| canon | w=2 | w=4 | w=8 | w=16 | w=32 |
|---|---|---|---|---|---|
| alnum | 0.87 | 0.80 | 0.54 | 0.30 | 0.25 |
| stem | 0.90 | 0.83 | 0.70 | 0.32 | 0.23 |
| skeleton | 0.92 | 0.82 | **0.81** | 0.51 | 0.19 |
| initials | 0.89 | 0.80 | 0.65 | 0.35 | 0.18 |

collision rate at w=2: 0.10 (alnum), **0.41** (skeleton)

Three things worth noting:

1. `q` decays roughly as `(1 - token change rate)^width`, so narrow windows are
   essential and the whole design is width-constrained.
2. The function-word skeleton beats literal normalisation substantially at
   moderate widths (0.81 vs 0.54 at w=8). Choosing edit-robust context
   features is a contribution in its own right and it is the genuinely
   linguistic part of the problem.
3. Narrow windows collide. At w=2 the skeleton address is duplicated 41% of the
   time, and a duplicated address carries no new information. This is the
   tension the paper is actually about, and no existing work measures it.

Against `q* = 0.632`, the decision boundary lands *inside* this range. That is
what makes the measurement worth running.

## Corrections after external review

- `design_coded` applied the anchor's `log2(D)` validation discount twice.
  Fixed; coded-context costs rise ~25% and the payload crossover moves from
  ~64 to ~96 bits. Regression test added.
- RNG seeds came from `tuple.__hash__()`, which Python salts per process.
  Replaced with BLAKE2b. Synthetic runs are now reproducible.
- `coded-soft` is relabelled `coded-soft(BOUND)`: dense noisy linear equations
  are Learning Parity with Noise and the capacity figure is not achievable
  without a deliberately sparse structured code.
- GF(2) **rank** of the surviving coefficient matrix is now measured and
  reported. Entropy is descriptive; rank is what decides solvability.
- Composite channels renamed to neutral `synthA`/`synthB`, and C4 is now
  evaluated over a parameter surface rather than one invented channel.
- Seed field size is derived (`required_seed_bits`) rather than guessed.

## Layout

```
MODEL.md                    the mathematics
PREREGISTRATION.md          thresholds, dated
sweeps.py                   regenerates every number in MODEL.md
surface.py                  fragmentation x edit x thinning boundary map
RESULTS_model.txt           its output
RESULTS_stability_sample.csv  1140-row sweep over the bundled sample
src/cauf/
  text.py        tokenisation, five canonicalisers, context windows
  anchors.py     keyed content-defined anchor selection, collisions, entropy
  channels.py    marked documents; block-loss, thinning, mutation channels
  measure.py     the classification and its derived rates
  align.py       difflib alignment for real revision pairs
  model.py       the executable copy of MODEL.md
  corpora.py     Wikipedia fetcher, offline loaders, sample
  cli.py         stability / pairs / model / decide
tests/test_all.py
data/sample/     six short documents, smoke test only
```

## Known limitations of the harness

- The bundled sample is too small to measure address entropy; the column
  saturates. Use real corpora of 2 000+ words.
- Wikipedia revisions are *authoring* edits. The threat model is
  *redistribution*. The synthetic channels supply the second distribution and
  they were specified before measurement, but they are still ours.
- `align.py` treats a mark inside an edited span as lost. That under-counts
  misaddressing, which makes real-pair results optimistic; the synthetic
  `reword` channel covers the case honestly. Read the two together.
- Token-level diffing reads a moved paragraph as delete-plus-insert. Use the
  synthetic `reorder_paragraphs` channel for that case.
- Carrier thinning is measured per mark. Block-length effects are applied
  analytically in `model.py`, because block length depends on design
  parameters the harness has no opinion about.
