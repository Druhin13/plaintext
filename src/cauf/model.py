"""The overhead model.

Everything here is derived in MODEL.md; this module is the executable copy, so
that the paper's numbers and the experiment's numbers cannot drift apart.

Three architectures are priced on one axis, and the axis is **block length**.
All three scatter authenticated blocks of carrier bits through a document.  They
differ only in what a block contains and therefore in how long it has to be:

  MONOLITHIC  block = whole payload + MAC.  Any one intact block decodes.
              Block length grows with the payload, so survival under carrier
              thinning decays *exponentially* in payload size.
  INDEXED     block = chunk index + payload chunk + MAC.  Shorter blocks, but
              every chunk index must survive somewhere: a coupon-collector
              penalty of order log(n_chunks).
  CODED       block = address + c fungible coded bits + MAC.  Blocks are as
              short as the validation field allows, any n_obs of them decode,
              and block length is independent of payload size.

"Rateless" is not the source of the advantage.  Short blocks are.  Ratelessness
is what *permits* short blocks, by removing the requirement that a block be
individually sufficient or individually indexed.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Dict, Literal, Optional, Tuple

try:
    from scipy.stats import binom as _binom
    _HAVE_SCIPY = True
except Exception:  # pragma: no cover
    _HAVE_SCIPY = False


def h2(p: float) -> float:
    """Binary entropy in bits."""
    if p <= 0.0 or p >= 1.0:
        return 0.0
    return -p * math.log2(p) - (1 - p) * math.log2(1 - p)


def _min_trials_for_successes(k_needed: int, p: float, target: float,
                              cap: int = 2_000_000) -> Optional[int]:
    """Smallest N with P(Binom(N, p) >= k_needed) >= target."""
    if p <= 0.0:
        return None
    if k_needed <= 0:
        return 0
    n = k_needed
    if _HAVE_SCIPY:
        # geometric probe then bisect: the cdf is monotone in n
        hi = k_needed
        while hi < cap and _binom.sf(k_needed - 1, hi, p) < target:
            hi *= 2
        if hi >= cap:
            return None
        lo = max(k_needed, hi // 2)
        while lo < hi:
            mid = (lo + hi) // 2
            if _binom.sf(k_needed - 1, mid, p) >= target:
                hi = mid
            else:
                lo = mid + 1
        return lo
    # normal approximation fallback
    z = 2.326 if target >= 0.99 else 1.645
    n = k_needed
    while n < cap:
        mu, sd = n * p, math.sqrt(n * p * (1 - p)) or 1e-9
        if mu - z * sd >= k_needed:
            return n
        n += max(1, n // 16)
    return None


# --------------------------------------------------------------------------
# parameters
# --------------------------------------------------------------------------

Mode = Literal["tag", "roster"]


@dataclass
class Payload:
    """What has to be recovered, and how recovery is verified.

    ``roster`` mode is worth noticing: when the recipient set is known and
    small, no in-band MAC is needed at all.  The decoder solves for the id and
    checks membership.  That alone roughly halves the payload against the
    obvious ``tag`` design, and nothing in the literature does it because
    generation-time schemes do not usually know the recipient set.
    """

    mode: Mode = "tag"
    k_id: int = 48
    tau: int = 32           # in-band tag bits (tag mode)
    roster: int = 500       # number of legitimate recipients (roster mode)
    eps_false: float = 1e-6  # tolerated false-attribution probability
    enumerate_log2: int = 20  # affordable coset enumeration, 2**this candidates

    @property
    def k(self) -> int:
        return self.k_id + self.tau if self.mode == "tag" else self.k_id

    @property
    def slack_d(self) -> int:
        """Rank deficiency we can absorb by enumerating the solution coset.

        Solving to rank k-d leaves 2**d candidates; we enumerate and filter.
        Each observation we do not need is an observation we do not pay for, so
        this is a real and rarely-taken discount.
        """
        if self.mode == "tag":
            budget = self.tau - math.log2(1.0 / self.eps_false)
        else:
            budget = self.k_id - math.log2(self.roster / self.eps_false)
        return max(0, min(self.enumerate_log2, int(math.floor(budget))))

    def n_obs(self, rank_margin: int = 10) -> int:
        """Independent correct observations needed for reliable recovery."""
        return max(1, self.k - self.slack_d + rank_margin)


@dataclass
class Carrier:
    """Physical properties of the invisible carrier."""

    bits_per_char: float = 1.0   # ZWNJ/ZWJ renderer-safe binary pair
    name: str = "zw-binary"


@dataclass
class Security:
    """How strong the per-block validation has to be, and why.

    ``v`` is not a free choice.  Two independent requirements set a floor, and
    the thinning channel sets a ceiling, because ``v`` sits in the *exponent*
    of block survival.  That tension is the reason the design has an interior
    optimum instead of "use a 32-bit MAC like everyone else".
    """

    n_anchor_sites: int = 200     # decoder trial positions per document
    eps_contamination: float = 0.01
    eps_misaddress: float = 0.01
    density_D: int = 20

    def v_min_contamination(self, anchor_filtered: bool) -> float:
        """Bits needed so foreign carriers are not mistaken for ours."""
        trials = self.n_anchor_sites if anchor_filtered else self.n_anchor_sites * self.density_D
        return max(0.0, math.log2(trials / self.eps_contamination))

    def v_min_misaddress(self, n_obs: int, anchor_filtered: bool) -> float:
        """Bits needed so a mutated context is rejected rather than misread."""
        suppression = self.density_D if anchor_filtered else 1
        return max(0.0, math.log2(n_obs / (suppression * self.eps_misaddress)))

    def v_required(self, n_obs: int, anchor_filtered: bool) -> int:
        return int(math.ceil(max(
            self.v_min_contamination(anchor_filtered),
            self.v_min_misaddress(n_obs, anchor_filtered),
        )))


@dataclass
class Damage:
    """The measured channel.  ``q`` and ``sigma_block`` come from the harness."""

    sigma_block: float = 1.0   # P(carrier survives visible-text damage)
    q: float = 1.0             # P(address unchanged | carrier survived)
    thin_rate: float = 0.0     # independent per-carrier loss
    foreign_carriers: int = 0  # contaminating invisible chars in the document

    def block_survival(self, length_bits: int, carrier: Carrier,
                       needs_address: bool) -> float:
        """P(an atomic block of this length is intact and correctly addressed)."""
        chars = length_bits / carrier.bits_per_char
        p = self.sigma_block * (1.0 - self.thin_rate) ** chars
        if needs_address:
            p *= self.q
        return p


# --------------------------------------------------------------------------
# architectures
# --------------------------------------------------------------------------

@dataclass
class Design:
    name: str
    block_bits: int
    obs_per_block: int          # 0 for monolithic / indexed
    needs_address: bool
    blocks_needed: Optional[int]
    total_chars: Optional[float]
    detail: Dict[str, float] = field(default_factory=dict)

    def chars_per_1000_words(self, words: int) -> Optional[float]:
        if self.total_chars is None:
            return None
        return 1000.0 * self.total_chars / words


def design_coded(payload: Payload, carrier: Carrier, sec: Security,
                 dmg: Damage, c: int, addressing: Literal["context", "self"],
                 seed_bits: Optional[int] = None, rank_margin: int = 10,
                 target: float = 0.99) -> Design:
    """Coded observations, hard-decision (validate and erase)."""
    anchor_filtered = addressing == "context"
    n_obs = payload.n_obs(rank_margin)
    # v_required() ALREADY applies the anchor's log2(D) discount via its
    # ``anchor_filtered`` argument.  An earlier version subtracted log2(D) a
    # second time here, which priced context addressing at v=12 where
    # q_breakeven() assumes v=16, so the executable model and the closed form
    # disagreed by 4 bits per block.  Found in external review.
    v = sec.v_required(n_obs, anchor_filtered)
    if anchor_filtered:
        addr_bits = 0
    else:
        addr_bits = (seed_bits if seed_bits is not None
                     else required_seed_bits(sec.n_anchor_sites))
    block_bits = addr_bits + c + v
    p_blk = dmg.block_survival(block_bits, carrier, needs_address=anchor_filtered)
    blocks = _min_trials_for_successes(math.ceil(n_obs / c), p_blk, target)
    # A fixed s-bit sequential self-address can label at most 2**s blocks.
    # Heavily damaged parameter combinations can need more, and pricing those
    # as if the address field were unbounded silently understates the design.
    # Mark them infeasible instead.  Raised in external review, round two.
    if (not anchor_filtered and blocks is not None
            and blocks > (1 << addr_bits)):
        return Design(
            name=f"coded-{addressing}(c={c})", block_bits=block_bits,
            obs_per_block=c, needs_address=False, blocks_needed=None,
            total_chars=None,
            detail={"v": v, "addr_bits": addr_bits, "n_obs": n_obs,
                    "blocks_wanted": blocks, "addr_capacity": 1 << addr_bits,
                    "note": f"needs {blocks} blocks, {addr_bits}-bit address "
                            f"labels only {1 << addr_bits}"})
    total = None if blocks is None else blocks * block_bits / carrier.bits_per_char
    return Design(
        name=f"coded-{addressing}(c={c})",
        block_bits=block_bits, obs_per_block=c, needs_address=anchor_filtered,
        blocks_needed=blocks, total_chars=total,
        detail={"v": v, "addr_bits": addr_bits, "n_obs": n_obs,
                "p_block": round(p_blk, 6)},
    )


def design_monolithic(payload: Payload, carrier: Carrier, sec: Security,
                      dmg: Damage, target: float = 0.99) -> Design:
    """Whole payload plus MAC in one repeated block.  Glyphmark's CORE shape."""
    v = sec.v_required(1, anchor_filtered=False)
    block_bits = payload.k_id + v
    p_blk = dmg.block_survival(block_bits, carrier, needs_address=False)
    blocks = _min_trials_for_successes(1, p_blk, target)
    total = None if blocks is None else blocks * block_bits / carrier.bits_per_char
    return Design("monolithic", block_bits, 0, False, blocks, total,
                  {"v": v, "p_block": round(p_blk, 8)})


def design_indexed(payload: Payload, carrier: Carrier, sec: Security,
                   dmg: Damage, chunk_bits: int = 16,
                   target: float = 0.99) -> Design:
    """Indexed payload chunks, each independently authenticated and repeated.

    Glyphmark's MESSAGE shape.  Recovery needs at least one surviving copy of
    every chunk index, which is where the log(n_chunks) penalty enters.
    """
    n_chunks = max(1, math.ceil(payload.k_id / chunk_bits))
    idx_bits = max(1, math.ceil(math.log2(max(2, n_chunks))))
    v = sec.v_required(1, anchor_filtered=False)
    block_bits = chunk_bits + idx_bits + v
    p_blk = dmg.block_survival(block_bits, carrier, needs_address=False)
    if p_blk <= 0:
        return Design("indexed", block_bits, 0, False, None, None,
                      {"n_chunks": n_chunks, "v": v})
    # copies per chunk so that all chunks survive with probability >= target
    per_chunk_target = target ** (1.0 / n_chunks)
    denom = math.log(max(1e-300, 1.0 - p_blk))
    r = math.ceil(math.log(max(1e-300, 1.0 - per_chunk_target)) / denom)
    blocks = int(r * n_chunks)
    total = blocks * block_bits / carrier.bits_per_char
    return Design("indexed", block_bits, 0, False, blocks, total,
                  {"n_chunks": n_chunks, "copies_per_chunk": r, "v": v,
                   "p_block": round(p_blk, 6)})


def design_soft(payload: Payload, carrier: Carrier, sec: Security,
                dmg: Damage, c: int = 8, rank_margin: int = 10,
                code_efficiency: float = 0.85) -> Design:
    """Context-addressed single-bit observations, no per-block validation.

    NOT AN ACHIEVABLE DESIGN.  This returns an optimistic information-theoretic
    bound and should never be quoted as system performance.  Recovering a
    secret from *dense* random linear equations with noisy right-hand sides is
    Learning Parity with Noise, for which no efficient decoder is known; BSC
    capacity times a fudge factor is only reachable with a deliberately sparse,
    structured code built for belief propagation or bit-flipping, and sparsity
    degrades the rank behaviour that ``n_obs`` assumes.  Flagged in external
    review; the hard-validation path does not depend on any of these numbers.


    Misaddressed observations are not rejected, they are decoded as noise: the
    channel is a BSC whose crossover is (1-q)/D suppressed by the anchor test.
    This is the cheapest design when the context is stable and nothing else is
    inserting invisible characters, and it fails abruptly when either of those
    stops holding.
    """
    n_obs = payload.n_obs(rank_margin)
    a_true = dmg.q
    a_wrong = (1.0 - dmg.q) / sec.density_D
    bogus = dmg.foreign_carriers / sec.density_D
    surv = dmg.sigma_block * (1.0 - dmg.thin_rate)

    def delivered(n_placed: int) -> Tuple[float, float, float]:
        """(information bits delivered, crossover p, accepted count).

        A misaddressed or contaminating observation is not a *flipped* bit, it
        is a *random* linear constraint: the decoder reads ``a' . m = y`` where
        ``a'`` is the wrong coefficient vector, and the true payload satisfies
        that with probability one half.  So the BSC crossover is

            p = 0.5 * (misaddressed + bogus) / accepted

        and it is bounded above by 0.5, never approaching 1.  Getting this
        wrong matters: binary entropy is symmetric, so treating contaminated
        observations as flipped rather than random makes a hopelessly
        contaminated channel look like a nearly noiseless one.

        Monotone increasing in ``n_placed``: correct observations grow linearly
        while the contaminating count is fixed.  A fixed-point iteration on
        this oscillates; a monotone search does not.
        """
        good = n_placed * surv * a_true
        junk = n_placed * surv * a_wrong + bogus
        acc = good + junk
        if acc <= 0:
            return 0.0, 0.5, 0.0
        p = 0.5 * junk / acc
        return acc * (1.0 - h2(p)) * code_efficiency, p, acc

    p_limit = 0.5 * a_wrong / (a_true + a_wrong) if (a_true + a_wrong) > 0 else 0.5
    if surv <= 0 or p_limit >= 0.5:
        return Design("coded-soft(BOUND)", c, c, True, None, None,
                      {"n_obs": n_obs, "p_limit": round(p_limit, 4),
                       "note": "beyond BSC capacity at any budget"})

    lo, hi = 1, max(2, n_obs)
    while delivered(hi)[0] < n_obs:
        hi *= 2
        if hi > 50_000_000:
            return Design("coded-soft(BOUND)", c, c, True, None, None,
                          {"n_obs": n_obs, "note": "budget exceeds 5e7 carriers"})
    while lo < hi:
        mid = (lo + hi) // 2
        if delivered(mid)[0] >= n_obs:
            hi = mid
        else:
            lo = mid + 1
    _, p, acc = delivered(lo)
    # ``c`` observations share one anchor (PRF(key, ctx, j)) and cost nothing
    # extra, because the soft path carries no per-block field at all.  It only
    # changes how many anchor *sites* the document has to supply.
    return Design("coded-soft(BOUND)", c, c, True, math.ceil(lo / c),
                  lo / carrier.bits_per_char,
                  {"p_bsc": round(p, 5), "n_obs": n_obs, "carriers": lo,
                   "capacity": round(1.0 - h2(p), 4), "bogus": round(bogus, 1)})


# --------------------------------------------------------------------------
# closed-form results
# --------------------------------------------------------------------------

def required_seed_bits(max_blocks: int, allocation: str = "sequential",
                       eps_collision: float = 0.01) -> int:
    """Size of the explicit address field for self addressing.

    Two allocation policies, and the difference is large enough that leaving it
    unstated is a real gap:

      ``sequential``  the encoder assigns 0, 1, 2, ... so there are no
                      collisions by construction and s = ceil(log2(blocks)).
                      The seeds are not secret: the coefficient vector is
                      PRF(key, seed), so a visible counter reveals nothing.
      ``random``      seeds drawn independently, so birthday collisions waste
                      observations.  Keeping the expected duplicate fraction
                      below eps needs 2**s >= blocks**2 / (2*eps).

    ``sequential`` is what the design should specify; ``random`` is here to
    show what it costs not to.
    """
    b = max(2, max_blocks)
    if allocation == "sequential":
        return max(1, math.ceil(math.log2(b)))
    if allocation == "random":
        return max(1, math.ceil(math.log2(b * b / (2.0 * eps_collision))))
    raise ValueError("allocation must be 'sequential' or 'random'")


def q_breakeven(c: int, sec: Security, payload: Payload, seed_bits: int,
                rank_margin: int = 10, thin_rate: float = 0.0,
                carrier: Optional[Carrier] = None) -> float:
    """Address survival above which context addressing beats self addressing.

    Equating cost per usable observation,

        (c + v_c) / (q * (1-r)**(L_c/b))  =  (s + c + v_s) / (1-r)**(L_s/b)

    with L_c = c + v_c and L_s = s + c + v_s, gives

        q*(r)  =  [(c + v_c) / (s + c + v_s)] * (1-r)**((L_s - L_c)/b)
               =  q*(0) * (1-r)**((s + v_s - v_c)/b)

    **q* is channel-dependent, and the zero-thinning value is only a
    reference.**  A self-addressed block is longer by the seed plus the
    validation bits the anchor would otherwise have supplied, so independent
    carrier loss penalises it disproportionately and the bar for context
    addressing falls.  At D=20, c=8, s=10, b=1 the threshold runs 0.632 at
    r=0, 0.549 at 1%, 0.476 at 2%, 0.308 at 5%.

    This composes with the finding in MODEL.md section 13 in a way worth
    noticing: thinning is both the only channel on which coded observations
    beat repeated packets *and* the channel that favours context addressing
    over self addressing.  The two open questions are not independent.
    """
    n_obs = payload.n_obs(rank_margin)
    v_s = sec.v_required(n_obs, anchor_filtered=False)
    v_c = sec.v_required(n_obs, anchor_filtered=True)
    q0 = (c + v_c) / (seed_bits + c + v_s)
    if thin_rate <= 0:
        return q0
    b = carrier.bits_per_char if carrier else 1.0
    return q0 * (1.0 - thin_rate) ** ((seed_bits + v_s - v_c) / b)


def optimal_cluster(overhead_bits: int, thin_rate: float) -> float:
    """Cluster payload ``c`` minimising bits per usable observation.

    Cost per observation is ``(u + c) / (c * (1-r)**(u+c))`` with u the fixed
    per-block overhead.  Setting the derivative of the log to zero:

        1/(u+c) - 1/c + alpha = 0,   alpha = -ln(1-r)

    which gives c* = (-u + sqrt(u**2 + 4u/alpha)) / 2.

    The shape is the point: with no thinning the optimum runs away to infinity
    (amortise the overhead over as many observations as possible), and any
    per-carrier loss pulls it back to a finite value.  Nobody chooses packet
    size this way today.
    """
    if thin_rate <= 0:
        return float("inf")
    alpha = -math.log(1.0 - thin_rate)
    u = float(overhead_bits)
    return (-u + math.sqrt(u * u + 4.0 * u / alpha)) / 2.0


def optimal_cluster_bruteforce(overhead_bits: int, thin_rate: float,
                               cmax: int = 4000) -> int:
    """Independent check of ``optimal_cluster`` by direct search."""
    best, best_c = float("inf"), 1
    for c in range(1, cmax + 1):
        L = overhead_bits + c
        p = (1.0 - thin_rate) ** L
        if p <= 0:
            break
        cost = L / (c * p)
        if cost < best:
            best, best_c = cost, c
    return best_c


def compare(payload: Payload, carrier: Carrier, sec: Security, dmg: Damage,
            c: int = 8, seed_bits: int = 10, words: int = 1000,
            chunk_bits: int = 16) -> Dict[str, Design]:
    """All five designs under one damage model."""
    return {
        "monolithic": design_monolithic(payload, carrier, sec, dmg),
        "indexed": design_indexed(payload, carrier, sec, dmg, chunk_bits),
        "coded-self": design_coded(payload, carrier, sec, dmg, c, "self", seed_bits),
        "coded-context": design_coded(payload, carrier, sec, dmg, c, "context"),
        "coded-soft": design_soft(payload, carrier, sec, dmg, c=c),
    }


def feasible(design: Design, words: int, sec: Security,
             collision_rate: float = 0.0) -> bool:
    """Can a document of this length actually host the required blocks?

    Context addressing has a hard supply limit that self addressing does not:
    one anchor per D words, minus duplicates.  A design can be cheap per
    observation and still not fit.
    """
    if design.blocks_needed is None:
        return False
    if not design.needs_address:
        return True
    sites = (words / sec.density_D) * (1.0 - collision_rate)
    return design.blocks_needed <= sites
