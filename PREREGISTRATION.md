# Pre-registered decision rules

**Written 21 September 2026, before any real corpus has been measured.**

The only data seen at the time of writing is the bundled six-document sample in
`data/sample/`, which exists to smoke-test the code and is too small to measure
address entropy (each document supplies about fifteen anchors, so the entropy
column saturates at ~3.9 bits). No threshold below was chosen after seeing a
real result.

The reason this file exists: the project has been emotionally locked, and a
locked project plus a soft kill criterion means the project never gets killed.
"If context addressing is not viable we stop" is unfalsifiable as written.
Below it is falsifiable.

---

## Fixed parameters

Thresholds are evaluated at these settings unless stated otherwise. Changing
them after seeing data is permitted only with a dated note in this file saying
what changed and why.

| parameter | value |
|---|---|
| carrier | renderer-safe binary (ZWNJ/ZWJ), `b = 1` bit/char |
| payload | `k_id = 48`, `tau = 32`, tag mode |
| cluster | `c = 8` |
| self-address baseline | `s = 10` bits (1024 sequential block addresses) |
| anchor density | `D = 20` |
| document length | 5 000 words |
| anchor sites assumed for validation sizing | `n_anchor_sites = 400` |
| seed allocation | **sequential and unique**; configurations needing >1024 blocks are infeasible at the fixed 10-bit baseline and are reported separately with a widened seed |
| validation strength | as computed by `Security.v_required`, applied **once** |
| contamination budget | `eps_contamination = 0.01` |
| misaddressing budget | `eps_misaddress = 0.01` |
| recovery target | 99% |
| coefficient vectors | dense (sparse only for the exploratory soft path) |
| fingerprint instances per document | **exactly one** |
| recovery criterion | GF(2) **rank** of the surviving coefficient matrix, not address entropy |

At these settings `q*(r=0) = 0.6316`. **`q*` is channel-dependent** and must
be evaluated at the thinning rate C6 measures: 0.549 at 1%, 0.476 at 2%, 0.308
at 5%. C1's thresholds below are stated against `q*(r)` at the measured `r`,
not against the zero-thinning reference.

`n_anchor_sites` is fixed here because it feeds validation sizing and therefore
`q*`: at 400 sites `q* = 0.632`, at the 250 a 5 000-word document at `D=20`
actually supplies, `q* = 0.622`. Small, but a pre-registration that leaves a
threshold input free is not one.

Seed allocation is fixed as sequential. The preregistered baseline keeps
`s = 10`, so it can address at most 1024 coded blocks. A configuration that
needs more is **infeasible under the baseline** rather than silently widening
the address; widened seeds are a separately reported sensitivity analysis.
Random seeds at `s = 10` collide badly (`required_seed_bits(1000, "random")`
is 16 bits, not 10). Sequential allocation avoids those collisions.

One fingerprint per document is a scope decision, not an oversight. Two
recipients' observations in one artefact would mix into a single equation set
with nothing to separate them; Glyphmark handles this with a 2-byte `mark_id`
that groups packets before decoding, and the coded design has no equivalent
namespace. Adding one costs bits per block and belongs to the multi-source
extension, not here. Mixed-source documents are out of scope and the paper
must say so.

## Primary channels

Thresholds are evaluated on **`reword-10`** (context mutation in isolation) and
**`synthA-frag3-rw10-sp20`** (three fragments totalling 35%, 10% rewording,
20% spliced foreign text). Results on the other channels are reported but do
not gate anything.

The composite channels were renamed from `leak-realistic` / `leak-hostile`.
We chose those parameters and nothing yet shows they resemble how documents are
actually excerpted and redistributed. Naming an invented distribution
"realistic" and then pre-registering a pass mark against it is setting our own
exam. The names stay neutral until they are calibrated against plagiarism or
quotation corpora, and C4 below is now stated over a surface rather than a
cell.

## Corpora

- **Wikipedia consecutive revision pairs**, binned by edit magnitude. Supplies
  realistic *authoring* edits, which is what calibrates the context-mutation
  channel.
- **Synthetic redistribution channels** on long-form prose. Supplies the
  fragmentation geometry that Wikipedia does not contain.

Both are required. Reporting either alone would be misleading, and the
synthetic distributions were specified in `channels.py` before measurement, not
tuned afterwards.

---

## C1 — Addressing choice

Let `q_best` be the highest `q` achieved by any (canonicaliser, width)
configuration that also satisfies C2 and C3, on `synthA-frag3-rw10-sp20`.

All three bands are stated as multiples of `q*(r)` at the measured thinning
rate, because a fixed numeric bar would be wrong for any thinning channel.

- `q_best > 1.11 x q*(r)` → **context addressing.** Comfortably clear of `q* = 0.632`
  with margin for the model's approximations.
- `0.87 x q*(r) <= q_best <= 1.11 x q*(r)` → **hybrid.** Self-addressed observations carry the
  payload; sparse context-bound anchors are budgeted separately to buy
  anti-transplant binding. MODEL.md §5 prices that binding directly.
- `q_best < 0.87 x q*(r)` → **context addressing is abandoned.** Self-addressed coded
  observations, and the paper's contribution becomes the channel
  characterisation rather than the construction.

Note that C1 cannot kill the *project*. Every branch produces a publishable
result. C1 only decides which artefact gets built, and writing that down now is
what stops a late finding being reinterpreted as a setback.

## C2 — Anchor supply

The chosen configuration must need no more anchor sites than a 5 000-word
document supplies at its `D`, with a 1.5x margin. Per MODEL.md §10 this fails
at `D = 64` for a 128-bit payload, so `D` may have to come down, which in turn
raises the misaddressing rate. If no `(D, c)` pair satisfies both C1 and C2,
context addressing is abandoned regardless of `q`.

## C3 — Address entropy

On a corpus of documents averaging at least 2 000 words:

- collision rate (anchors sharing a canonical address) **< 0.05**, and
- empirical address entropy **>= log2(n_anchors) - 1.0 bits**.

The sample corpus already shows this failing at width 2 (collision rate 0.41
for `skeleton`), which is the expected shape: narrow windows survive editing
and carry no information. If no width satisfies C1 and C3 simultaneously, the
same conclusion follows as a C1 failure.

## C4 — Project kill

The one criterion that can end the project. At equal invisible-character
budget, over the preregistered `surface.py` redistribution grid, with a payload of at least 128 bits:

> Over the `surface.py` grid (fragments x retention x rewording x thinning), if
> the best coded design does not require at least **2x fewer** carrier
> characters than the best repeated-packet baseline in a **contiguous region of
> at least a quarter of the cells**, there is no paper and we stop.

A region rather than a point, because a margin that appears in one
hand-picked cell of a grid we designed is not a result. 2x rather than
any-improvement, because a smaller margin will not survive the modelling
assumptions in MODEL.md §11.

As of the corrected model, the sample-corpus surface satisfies this **only in
the cells with non-zero thinning**, which is what C6 now exists to settle.

Explicitly **not** a kill: losing to repeated packets at 32–48 bit payloads, or
on short contiguous excerpts, or on an undamaged channel. MODEL.md §7 and §8
predict all three, they are the boundary the paper is about, and finding them
confirms the model rather than refuting the project.

## C6 — Does the channel actually thin carriers? *(added after the surface sweep)*

MODEL.md §13: at zero thinning the monolithic packet wins **every cell** of the
surface, including ten fragments at 35% retention with 25% rewording. The coded
advantage comes almost entirely from independent per-carrier loss, not from
fragmentation. So:

> Paste marked text through Word, Google Docs, Slack, Outlook, a PDF
> export-and-extract round trip, a Markdown renderer, and two or three
> sanitisers. For each, record whether carriers are preserved, **partially**
> removed, or removed wholesale.
>
> If no realistic pipeline removes carriers *partially* — if every channel
> either preserves the carrier class or strips it entirely — then the coded
> advantage has no source and the project stops, regardless of C1 through C5.

Glyphmark documents Word silently stripping U+200B on paste while preserving
ZWNJ/ZWJ, which is evidence that code-point-selective loss is real. That is a
hint, not a measurement. This is a day of work and it now outranks the context-
stability sweep in priority.

## C7 — Is a payload above 96 bits justified?

MODEL.md §7: below about 96 bits the repeated-packet designs win, and a
deployment can embed a 32-bit opaque key and resolve the rest server-side.
Before the payload-scaling result is used as a headline, one paragraph has to
name a deployment that cannot use a lookup table. Public-verifiable provenance
(an in-band Ed25519 signature, verifiable across organisations with no shared
database) is the strongest candidate, and MODEL.md §14 now gives a concrete
construction for it: keyless addressing and block checksums, with the only key
being the signing key whose signature rides inside the coded payload.

C7 is **not** discharged by that. It closes only when someone has (a) specified
what the Ed25519 signature binds to so that a recovered signed payload cannot
just be re-encoded into unrelated visible text, (b) specified how a verifier
obtains the correct public key for `key_id`, (c) written the verifier end to
end, and (d) confirmed with the harness that keyless addressing does not
degrade `q` or the collision rate relative to the keyed version. If the
construction does not survive, the payload-scaling section is cut and the
paper rests on §13 alone. Public verifiability may not be invoked as a
justification before all four are done.

## C5 — The prerequisite that gates the headline

Glyphmark's MESSAGE chunk placement must be read from source, not the README.

- **i.i.d. chunk indices** → coupon collection holds, the `k log k` scaling
  claim in MODEL.md §7 stands.
- **round-robin** → under contiguous excerpts a run of `n_c` consecutive
  packets contains every index, the penalty vanishes, and the payload-scaling
  claim must be restated as applying to fragmented or thinned survival only.

Section 7 of MODEL.md may not be quoted in any write-up until this is settled.

---

## Reporting commitments

1. Report the full (canonicaliser × width × D × channel) grid, not the best
   cell. The sample sweep is already 1 140 rows; there is no excuse for
   reporting one.
2. Report survival by **run-length distribution** of surviving text, not by
   "percentage retained". The latter is the statistic the existing literature
   uses and it is the wrong one.
3. Report the undamaged and short-excerpt cases where repeated packets win,
   in the same table as the cases where they lose.
4. State the threat model in the abstract: a recipient who redistributes
   without suspecting a watermark, plus incidental channel damage. Not an
   adversary who can strip the carrier class.

---

## Amendments

*(Any change to the above goes here, dated, with the reason, before the
affected measurement is re-run.)*

- **21 Sep 2026, same day, before real data.** External review found that
  `design_coded` applied the `log2(D)` anchor discount twice. Corrected. `q*`
  is unchanged (the closed form was already right); the coded-context costs in
  MODEL.md §7 rise by about 25% and the payload crossover moves from ~64 to
  ~96 bits. C4's 2x bar is unchanged.
- **21 Sep 2026.** RNG seeding used `tuple.__hash__()`, which Python salts per
  process, so synthetic runs were not reproducible across invocations.
  Replaced with BLAKE2b over the repr of the tuple.
- **21 Sep 2026.** Added C6 and C7 after the corrected surface sweep showed the
  coded advantage depends on carrier thinning and on payloads above ~96 bits,
  both of which are unverified and both of which outrank context stability.
- **21 Sep 2026, round two.** External review found the anchor discount
  applied twice at a second site (the CLI's optimal-cluster reporting), and
  that `surface.py` seeded the RNG on the thinning rate, so the r=0 and r=2%
  rows priced different damaged documents. Both fixed.
- **21 Sep 2026, round two.** `q*` corrected to include thinning. C1's bands
  restated as multiples of `q*(r)` rather than fixed numbers.
- **21 Sep 2026, round two.** A fixed s-bit sequential self-address labels at
  most `2**s` blocks; designs needing more are now marked infeasible instead
  of priced.
- **21 Sep 2026.** `n_anchor_sites`, seed allocation policy, coefficient-vector
  density, the one-fingerprint-per-document scope, and rank-not-entropy as the
  recovery criterion added to the fixed parameters. They were inputs to the
  thresholds and were previously left free.
