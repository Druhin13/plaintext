# Review notes — 21 September 2026

This repository baseline has been independently reviewed against the executable
model and test suite before the first commit. It is **research infrastructure,
not a validated result**.

## What is currently trusted

- The package extracts cleanly and the test suite passes: **37/37**.
- The validation discount is applied once in both the executable model and CLI.
- Synthetic RNG seeding is deterministic across processes.
- `surface.py` holds the damaged visible document fixed when only analytical
  carrier thinning changes.
- `q_breakeven()` includes per-carrier thinning and is regression-tested against
  the executable cost ratio.
- A fixed self-address width cannot silently address more than `2**s` blocks.
- GF(2) rank, rather than address entropy alone, is reported for solvability.
- The preregistered surface now uses the preregistered `n_anchor_sites=400` and
  `s=10` baseline.

## What is **not** established yet

### C6 is the highest-priority empirical gate

The coded design only has a large structural advantage in the current model when
real workflows produce **partial per-carrier thinning**. If Word, Docs, Slack,
Outlook, PDF round trips and sanitizers only preserve all carriers or strip the
entire carrier class, the model's main advantage disappears. Measure this before
large corpus work.

### C7 public verification is still a candidate, not a solved construction

The proposed Ed25519 variant demonstrates a plausible large-payload regime, but
two cryptographic details remain open:

1. **Cover-text binding / rebinding.** A signature over recovered metadata alone
   does not stop someone who learns a valid signed payload from re-encoding it
   into unrelated visible text when addressing/checksums are keyless. The signed
   statement must be defined so that it binds to the intended source while still
   supporting fragment verification.
2. **Public-key discovery.** A 32-bit `key_id` does not itself tell an unrelated
   verifier which Ed25519 public key to trust. The trust/discovery mechanism must
   be explicit.

Until those are solved and an end-to-end verifier exists, the 592-bit public-
verification example must not be used as proof that large payloads are required.

### C5 still needs Glyphmark source inspection

The indexed baseline's behavior under contiguous excerpts depends on actual
MESSAGE scheduling. The model currently prices independent block erasure; it
should not be described as a generic coupon-collector result. Read the source
and document whether scheduling is deterministic/round-robin, random, or another
policy before making the payload-scaling claim.

## Smoke-surface status

After aligning `surface.py` with the preregistered baseline (`s=10`,
`n_anchor_sites=400`), the six-document smoke surface has **9/36** cells where a
coded design is at least 2x cheaper than the best repeated-packet baseline. All
nine require 2% analytical carrier thinning. This is exactly one quarter of the
grid and therefore sits on the C4 boundary, but it is **not evidence**: the corpus
is deliberately too small and the thinning rate is hypothetical until C6 is
measured.
