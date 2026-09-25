# The overhead model

Every formula here is implemented in `src/cauf/model.py` and every number is
produced by `python3 sweeps.py` (output in `RESULTS_model.txt`). The closed
forms are checked against brute-force search in `tests/test_all.py`, so the
paper's algebra and the experiment's code cannot drift apart.

---

## 0. What the model is for

The project's open question is whether an address derived from mutable cover
text is worth using. That is a cost question, and it cannot be answered by
measurement alone: the measurement returns a number, and the model says which
side of which line that number falls on. So the model comes first and the
thresholds get written down before the data arrives.

---

## 1. Notation

| symbol | meaning |
|---|---|
| `k_id` | fingerprint payload, bits |
| `tau` | in-band verification tag, bits |
| `k` | total coded payload = `k_id + tau` (tag mode) or `k_id` (roster mode) |
| `d` | rank deficiency absorbed by coset enumeration |
| `n_obs` | independent correct observations needed = `k - d + margin` |
| `b` | bits carried per invisible character |
| `c` | coded observations per block |
| `s` | explicit address (seed) field, bits |
| `v` | per-block validation field, bits |
| `V` | validation *strength*, bits, including anything the anchor contributes |
| `D` | anchor density: one gap in `D` is an anchor |
| `L` | block length in bits = address + payload + validation |
| `sigma` | P(a carrier survives the visible-text damage) |
| `q` | P(the canonical address is unchanged \| the carrier survived) |
| `r` | independent per-carrier loss rate (thinning) |

`sigma`, `q` and the anchor re-fire rate are the three quantities the harness
measures. Everything else is a design choice.

---

## 2. One architecture axis, not three rival schemes

All post-hoc structural fingerprints scatter authenticated blocks of carrier
bits through a document. They differ only in what a block contains, and
therefore in how long a block has to be.

| | block contains | recovery needs | block length |
|---|---|---|---|
| **monolithic** | whole payload + MAC | any one block | grows with payload |
| **indexed** | chunk index + chunk + MAC | one copy of *every* index | fixed, medium |
| **coded** | address + `c` fungible coded bits + MAC | any `n_obs` observations | fixed, short |

Glyphmark's CORE packet is the monolithic row and its MESSAGE packet is the
indexed row. The coded row is the one this project is proposing.

**Block length is the master variable.** "Rateless" is not the source of any
advantage; short blocks are. Ratelessness is what *permits* short blocks, by
removing the requirement that a block be individually sufficient (monolithic)
or individually labelled (indexed). Framing the paper around fountain codes
invites the reviewer's correct objection that fountain codes are textbook.
Framing it around block length does not, because nobody has asked what the
optimal block length is on this channel.

---

## 3. Sizing the payload: two discounts nobody takes

### 3.1 Coset enumeration

Solving to full rank `k` is wasteful. Solve to rank `k - d`, enumerate the
`2^d` solutions in the coset, and filter each against the verification test.
`2^20` candidates is about a second of HMAC evaluations.

The constraint is the false-attribution budget:

- tag mode: false accept `= 2^(d - tau)`, so `d <= tau - log2(1/eps)`
- roster mode: false accept `= 2^d * N / 2^k_id`, so `d <= k_id - log2(N/eps)`

Every unit of `d` is one observation not paid for.

### 3.2 Roster mode

When the recipient set is known and small, **no in-band tag is needed at all**.
The decoder solves for the id and checks membership in the roster. From
`RESULTS_model.txt` section 7, at `sigma=0.3, q=0.8, r=0.01`:

| mode | roster | k | coset slack d | observations | coded-context chars |
|---|---|---|---|---|---|
| tag | — | 80 | 12 | 78 | 1820 |
| roster | 500 | 40 | 11 | 39 | 1120 |
| roster | 50 000 | 40 | 4 | 46 | 1260 |

A 1.6x saving from an accounting change. Generation-time schemes cannot do
this because they do not know the recipient set at detection time; a leak-
tracing deployment always does.

---

## 4. Sizing the validation field

`v` is not a free choice. Two requirements set a floor and the thinning
channel sets a ceiling, because `v` sits in the *exponent* of block survival.
That tension is why the design has an interior optimum rather than "use 32
bits like everyone else".

**Floor 1, contamination.** A decoder that tries `T` positions per document
accepts foreign carriers at rate `T * 2^-v`. For `eps_c = 0.01`:
`v >= log2(T / eps_c)`. Context addressing only tries *anchor* positions, so
`T = W/D` rather than `W`; the anchor test contributes `log2(D)` bits of
validation for free.

**Floor 2, misaddressing.** A mutated address must be rejected, not misread.
It has to re-satisfy the anchor test (probability `1/D`) *and* pass the MAC
(probability `2^-v`), so `v >= log2(n_obs / (D * eps_m))`.

**Ceiling, thinning.** Block survival is `(1-r)^(L/b)` and `v` is part of `L`.

Net: at equal validation strength `V`, context addressing pays
`v_c = V - log2(D)` and self addressing pays `v_s = V`.

---

## 5. Cost per usable observation

Per block, context addressing carries `c + v_c` bits and yields `c` usable
observations with probability `q`; self addressing carries `s + c + v_s` bits
and yields `c` with probability 1 (there is no address to corrupt):

```
cost_context = (c + v_c) / (c * sigma * q)
cost_self    = (s + c + v_s) / (c * sigma)
```

Setting them equal gives the decision rule for milestone 1:

> **Context addressing beats self addressing iff `q > q*(r)`, where**
>
> ```
> q*(r) = [(c + v_c) / (s + c + v_s)] * (1-r)**((s + v_s - v_c) / b)
> ```

**`q*` is channel-dependent and the zero-thinning value is only a reference.**
A self-addressed block is longer than a context-addressed one by the seed plus
the validation bits the anchor would otherwise have supplied, so independent
carrier loss penalises it disproportionately. At `D=20, c=8, s=10, b=1`:

| r | 0 | 1% | 2% | 5% |
|---|---|---|---|---|
| `q*` | 0.632 | 0.549 | 0.476 | 0.308 |

This composes with §13 in a way worth noticing: thinning is both the only
channel on which coded observations beat repeated packets **and** the channel
that favours context addressing over self addressing. The two open questions
are not independent, and a pre-registered threshold quoted at `r=0` is the
wrong one for any channel that actually thins.

From `RESULTS_model.txt` section 4, with `s = 10` and `k_id = 48`:

| D \ c | 4 | 8 | 16 | 32 |
|---|---|---|---|---|
| 8 | 0.606 | 0.649 | 0.711 | 0.787 |
| 20 | 0.588 | 0.632 | 0.696 | 0.774 |
| 64 | 0.556 | 0.600 | 0.667 | 0.750 |
| 256 | 0.526 | 0.571 | 0.640 | 0.727 |

So `q*` lives in **0.52 to 0.79**, and sharpens as `c` grows: large clusters
amortise the seed away, which removes context addressing's only advantage while
leaving its loss rate intact.

**Correction to an earlier estimate.** A first pass at this put `q*` near 0.82
by charging context addressing for validation bits and self addressing for
none. That is not a fair comparison: both need to reject contaminated carriers.
Equalising validation strength moves the threshold from "almost anything
passes" to "roughly a coin flip", which is the difference between a measurement
that cannot kill the design and one that can.

---

## 6. Optimal block size under thinning

Cost per observation is `(u + c) / (c * (1-r)^(u+c))` with `u` the fixed
per-block overhead. Differentiating the log:

```
1/(u+c) - 1/c + alpha = 0,    alpha = -ln(1-r)
=>  c* = ( -u + sqrt(u^2 + 4u/alpha) ) / 2
```

Verified against brute-force search for all `u` in {5, 11, 19, 26, 42, 80} and
all `r` in {0.001 … 0.2} (`test_optimal_cluster_matches_brute_force`).

| overhead u | r=0.002 | r=0.01 | r=0.05 | r=0.10 |
|---|---|---|---|---|
| 11 | 69 | 28 | 10 | 6 |
| 19 | 88 | 35 | 12 | 7 |
| 26 | 102 | 39 | 13 | 7 |
| 42 | 125 | 47 | 15 | 8 |

The shape is the result: with no thinning the optimum runs to infinity
(amortise overhead over as many observations as possible) and any per-carrier
loss pulls it back to a finite value. No existing scheme chooses packet size
this way.

---

## 7. Payload scaling

At `sigma=0.3, q=0.8, r=0.01`, carrier characters for 99% recovery
(`RESULTS_model.txt` section 1):

| payload id bits | monolithic | indexed | coded-self | coded-context | mono/ctx |
|---|---|---|---|---|---|
| 32 | 1 248 | 1 702 | 2 812 | 1 944 | 0.6x |
| 48 | 1 972 | 2 850 | 3 306 | 2 280 | 0.9x |
| 64 | 2 856 | 4 104 | 3 800 | 2 616 | 1.1x |
| 96 | 5 452 | 6 786 | 4 750 | 3 264 | 1.7x |
| 128 | 9 768 | 9 360 | 5 662 | 3 912 | 2.5x |
| 256 | 67 344 | 21 120 | 9 234 | 6 360 | 10.6x |
| 512 | 1 713 572 | 48 544 | 16 036 | 11 016 | 156x |

> **Revised after external review.** `design_coded` applied the anchor's
> `log2(D)` discount a second time on top of the one `v_required` already
> applies, pricing context blocks at `v=12` where §5's closed form assumes
> `v=16`. The executable model and the closed form disagreed by four bits per
> block for the whole first version, and the test that should have caught it
> had a tolerance band wide enough to hide it. Both are fixed;
> `test_validation_discount_applied_exactly_once` is the regression.

Three scalings, and this is the cleanest theoretical claim available:

- **monolithic: exponential in payload.** Block length is `k_id + v`, survival
  is `(1-r)^(k_id+v)`, so cost is `(k_id+v) * ln(1/eps) * (1-r)^-(k_id+v)`.
- **indexed: `k log k`.** Coupon collection over `n_c = k_id/w` chunk indices
  needs about `ln(n_c/eps)` copies of each.
- **coded: linear.** Block length does not depend on the payload at all.

**At 32 to 64 payload bits the repeated-packet designs win.** That is not a
result to be embarrassed by; it is the boundary, and stating it is what makes
the rest credible. The crossover with this damage model is near 96 bits, not
64 as the pre-correction numbers suggested.

**And a payload that large has to be justified.** A leak-tracing deployment can
embed a 32-bit opaque identifier and resolve everything else server-side, which
is what Glyphmark's 10-byte packet does. If the payload can always be a short
lookup key, the whole right-hand side of this table solves a problem nobody
has. §3.2's roster-mode discount makes this worse, not better: it argues for
*smaller* payloads and directly undercuts §7's headline. The two sections pull
against each other and the project has to pick one.

The defensible large-payload case is **public verifiability**. An HMAC tag
resolves against a private key held by one organisation; a third party who must
verify without being able to forge needs a signature carried in band. Ed25519
is 512 bits. That is exactly the regime where §8 says monolithic packets die
exponentially, and it is a use case a lookup table cannot serve because there
is no shared database across organisations. If the paper keeps the payload-
scaling headline, that is the scenario it has to be about, and it should be
stated in the abstract rather than defended in rebuttal.

---

## 8. Thinning sensitivity

At `k_id=128, sigma=1.0, q=0.9` (`RESULTS_model.txt` section 2):

| thin rate | monolithic | indexed | coded-context(c=8) |
|---|---|---|---|
| 0.000 | 148 | 312 | 540 |
| 0.005 | 1 184 | 1 248 | 620 |
| 0.010 | 2 664 | 1 872 | 720 |
| 0.020 | 13 320 | 3 744 | 920 |
| 0.050 | 1 350 056 | 14 352 | 1 840 |
| 0.100 | — | 126 048 | 5 700 |

On an undamaged channel the monolithic packet is the cheapest thing you can
build, by 3.6x. One percent carrier loss reverses that by 3.7x and five
percent reverses it by 730x. This matches Glyphmark's own published behaviour:
its word-safe encoding collapses between 5% and 10% uniform per-character
deletion because a packet is 80 zero-width characters and `0.9^80` is
effectively zero.

---

## 9. Contamination, and why RANSAC is not an option

### 9.1 Misaddressed observations are random, not flipped

A misaddressed carrier gives the decoder `a' . m = y` where `a'` is the wrong
coefficient vector. The true payload satisfies that with probability **one
half**, so the BSC crossover is

```
p = 0.5 * (misaddressed + contaminating) / accepted      <= 0.5
```

This is easy to get wrong and the error is not benign: binary entropy is
symmetric, so treating contamination as bit-flips rather than random
constraints makes a destroyed channel look nearly noiseless. An earlier draft
of `model.py` did exactly that and reported a hopelessly contaminated document
as recoverable from one carrier. `test_contamination_never_helps_the_soft_path`
exists to stop it recurring.

### 9.2 Unvalidated dense decoding is dead

Dense GF(2) decoding with RANSAC needs a clean sample of `n_obs` equations, so
the expected trial count is `(1-p)^-n_obs`:

| p | clean sample | expected trials |
|---|---|---|
| 0.05 | 78 | 55 |
| 0.10 | 78 | 3.7e3 |
| 0.21 | 78 | 9.7e7 |
| 0.30 | 78 | 1.2e12 |
| 0.51 | 78 | 1.5e24 |

Glyphmark's published anchor table gives region-change rates of 0.21 at 40-char
windows under 20% deletion and 0.51 at 100-char windows. Both are already out
of reach. **Validation bits or sparse soft decoding are mandatory; there is no
third option.** This closes one of the four alternatives listed in the
project's own draft.

### 9.3 The soft path and its cliff

Dropping the per-block MAC entirely and treating misaddressing as BSC noise is
much cheaper when the document is clean, because the anchor test alone
suppresses misaddressing by a factor `D`. It is also the path that breaks
first. At `sigma=0.5, k_id=48`:

| q | foreign chars | soft chars | p | validated chars |
|---|---|---|---|---|
| 0.95 | 0 | 196 | 0.001 | 700 |
| 0.95 | 2 000 | 384 | 0.178 | 700 |
| 0.8 | 0 | 240 | 0.006 | 840 |
| 0.8 | 4 000 | 571 | 0.235 | 840 |
| 0.4 | 4 000 | 1 170 | 0.241 | 1 780 |

The soft path stays cheaper in *characters* across this range, but it needs far
more anchor *sites*, and its failure mode is a cliff rather than a slope.
Glyphmark's word-safe mode emits on the order of four invisible characters per
visible word, so a document carrying both marks is a realistic 4 000-foreign-
character case, not a synthetic one. That is a real experiment: mark a document
with Glyphmark, then with ours, and decode. It uses a real artefact instead of
an attack we designed for ourselves to beat.

A cheap engineering answer worth testing: draw carriers from a class disjoint
from what other tools use (invisible operators U+2061–U+2064 rather than
ZWNJ/ZWJ). It defeats incidental contamination completely and a targeted
stripper not at all.

---

## 10. Anchor supply: the constraint self addressing does not have

Context addressing can only mark one gap in `D`. Blocks needed versus sites
available at `k_id=128, sigma=0.3, q=0.8, r=0.01` (`RESULTS_model.txt` §6):

| words | D=8 | D=20 | D=64 |
|---|---|---|---|
| 500 | no (153 > 62) | no (150 > 25) | no (145 > 7) |
| 1 000 | no (154 > 125) | no (151 > 50) | no |
| 2 000 | **yes** | no (153 > 100) | no |
| 5 000 | yes | **yes** | no (154 > 78) |
| 10 000 | yes | yes | yes |

A design can be cheap per observation and still not fit. This interacts
directly with `D`: raising `D` improves misaddressing suppression and
contamination rejection but starves the supply. Self addressing has no such
limit, which is a second reason it may win even where `q > q*`.

---

## 11. What the model does not cover

Stated so they can be attacked rather than discovered by a reviewer.

1. **Collusion.** Anchor positions depend only on the visible text and the key,
   so they are identical across recipients and two colluders can diff their
   copies to locate every mark. Deliberately out of scope (a colluder who
   knows the mechanism can strip the carrier class outright), but the threat
   model must say so, and the "500 employees" motivating story should be
   rewritten or dropped, since it invokes collusion whether or not we discuss
   it.
2. **Adaptive removal.** Any invisible scheme dies to a regex, to NFKC
   normalisation, or to retyping. The adversary is a recipient who
   redistributes without suspecting a watermark, plus incidental channel
   damage.
3. **Bursty versus independent survival.** Block loss and thinning are modelled
   separately and composed multiplicatively. Real damage correlates.
4. **Round-robin versus random chunk placement.** The indexed row assumes
   Bernoulli block survival. Under round-robin placement and a *contiguous*
   excerpt, `n_c` consecutive packets contain every index, so the coupon-
   collector penalty vanishes and the indexed design becomes near-optimal for
   contiguous excerpts. **Which one Glyphmark implements is not determinable
   from its README and decides how large the payload-scaling claim is.** Read
   the source before quoting section 7.
5. **Rank versus count.** The model counts observations and adds a margin; it
   assumes the coefficient vectors behave like a random ensemble. Address
   collisions break that, which is why the harness measures collision rate and
   address entropy.
6. **Code efficiency.** The soft path uses BSC capacity times 0.85. A real
   LDPC at these block lengths may do worse.

---

## 12. The decision rule

1. Measure `q`, `sigma` and the re-fire rate per (canonicaliser, width, D,
   channel).
2. Compute `q*` for the intended `c`, `D` and payload.
3. `q > q*` **and** the anchor supply fits **and** collision rate is low
   → context addressing, hard-decision, with `c` set by section 6.
4. `q <= q*` → self addressing. The address problem is engineered away, so the
   paper's contribution has to be the channel characterisation, not the
   construction. Write that contribution statement now, while it is cheap.
5. Either way, report the boundary rather than a winner.


---

## 13. The result that most threatens the project

`surface.py` sweeps fragmentation x retention x rewording x thinning at a
128-bit payload and reports which architecture is cheapest in each cell. The
pattern is stark:

| condition | cheapest | margin over packets |
|---|---|---|
| any fragmentation, any rewording, **thinning = 0** | monolithic | 1.00x |
| same, **thinning = 2%** | coded | 1.8x to 3.3x |

At zero thinning the monolithic packet wins **every cell**, including ten
fragments retaining 35% with 25% of content words rewritten. The reason is
structural: a monolithic packet needs exactly one surviving site, and block
loss, however severe and however fragmented, leaves surviving sites.

So the coded advantage does not come from fragmentation geometry at all. It
comes almost entirely from **independent per-carrier loss**, which enters block
survival as `(1-r)^L` and therefore punishes long blocks and only long blocks.

This was not visible before the surface sweep, and it inverts the project's
stated motivation. The original pitch was about excerpts, crops and paragraph
reordering. Those turn out to be the cases where we lose.

**Consequence: the project now has two unverified preconditions, not one.**

1. the deployment needs a payload above roughly 96 bits (§7), and
2. the channel does independent carrier thinning, not only block loss (§13).

Neither has been measured. Context stability, which the whole harness was built
to measure, is the *third* most important open question, behind both of these.

Precondition 2 is cheap to settle and nobody has: paste marked text through
Word, Google Docs, Slack, Outlook, a PDF export and extract, a Markdown
renderer, and a few sanitisers, and count which carriers survive. Glyphmark
already documents one instance of exactly this behaviour (Word silently strips
U+200B on paste), which is a strong hint that partial, code-point-selective
loss is real rather than hypothetical. If it only ever strips *all* carriers of
a class, that is block loss and the project is in trouble. If it strips some,
the project stands.


---

## 14. C7: a public-verification construction, and what it costs

"Ed25519 signatures are 512 bits" is an observation, not an architecture, and
the objection to it is correct: addressing and per-block validation currently
use secret-key PRFs, so a third party who can verify would also need the key,
which is the opposite of public verification.

There is a coherent construction, and it comes from splitting key usage by
what each layer actually protects.

| layer | current | public-verification variant |
|---|---|---|
| anchor predicate | `HMAC(key, ctx) mod D` | `H(ctx) mod D`, keyless |
| coefficient vector | `PRF(key, ctx, j)` | `H(ctx, j)`, keyless |
| per-block validation | `HMAC(key, ctx, bits)[:v]` | `H(ctx, bits)[:v]`, keyless |
| authenticity | per-block MAC | **Ed25519 signature inside the coded payload** |

The verifier recomputes addresses and block checksums with no secret, solves,
and verifies the recovered signature against a published key. Payload becomes
`key_id(32) || doc_id(32) || recipient(16) || signature(512)` = 592 bits.

**Why a lookup table cannot substitute here.** Resolving a 32-bit opaque
identifier server-side requires a database the verifier can reach. Cross-
organisation verification is defined by the absence of one. This is the answer
to §7's objection, and it is the only one I can construct that survives.

At `sigma=0.5, q=0.8`, carrier characters for this payload:

| thinning | monolithic | indexed | coded-context |
|---|---|---|---|
| 0 | 4 284 | 18 648 | 5 568 |
| 1% | 2 643 228 | 32 634 | 7 176 |
| 2% | — (infeasible) | 54 390 | 9 240 |

A 592-bit monolithic block has survival `(1-r)^592`, which is 0.26% at one
percent thinning. So the public-verification payload is the regime where the
coded design's advantage is largest, and §7 and §14 support each other rather
than pulling apart as §3.2 and §7 do.

**Four costs, none of them small.**

1. **Detectability is lost.** A keyless anchor predicate means anyone can tell
   a document is marked and where. The threat model already concedes an
   adversary who knows the mechanism can strip the carrier class, so this costs
   nothing against that adversary — but deployments that need the mark to be
   undetectable are excluded, and the paper must say so.
2. **Contamination resistance weakens to incidental only.** A keyless checksum
   still rejects misaddressing (a changed context fails it) and random foreign
   carriers at `2^-v`, but anyone can forge it. Under the stated threat model
   that is the right strength; it must not be claimed as more.
3. **Mixed-source gets worse.** Two publishers using the same keyless scheme
   place marks at identical anchors. Already out of scope, now more firmly so.
4. **Minimum document length.** 602 observations at `c=8` need 232 to 385
   blocks, so 4 600 to 7 700 words at `D=20`. Fine for a twenty-page strategy
   document, impossible for a memo. The construction has a length floor and
   the evaluation must report it.

Coset enumeration still works: `2^d` candidates each cost one signature
verification at roughly 50 microseconds, so `d=20` is about a minute. Roster
mode does not, since the verifier does not know the recipient set.

**This is a construction to evaluate, not a settled answer.** C7 stays open
until someone has written the verifier and confirmed that keyless addressing
does not degrade `q` or the collision rate relative to the keyed version — it
should not, since the key never entered the canonicalisation, but that is an
assumption and the harness can check it in an afternoon.