"""Invariants that, if broken, would produce plausible-looking wrong numbers.

Each test below corresponds to a way the measurement could quietly lie.
"""

from __future__ import annotations

import math
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

import pytest

from cauf import anchors, channels, model
from cauf import measure as _m
from cauf.measure import Tally
from cauf.align import Pair, edit_magnitude, gap_map, measure_pair
from cauf.anchors import AnchorSpec, find_sites, prf
from cauf.channels import (compose, crop, identity, place, recase,
                           reorder_paragraphs, repunctuate, reword,
                           splice_foreign, thin)
from cauf.corpora import load_dir_docs, sample_dir, vocabulary
from cauf.measure import measure_one
from cauf.model import (Carrier, Damage, Payload, Security, design_coded,
                        design_monolithic, design_soft, h2, optimal_cluster,
                        optimal_cluster_bruteforce, q_breakeven)
from cauf.text import ContextSpec, parse

KEY = b"test-key-0123456789"
DOCS = load_dir_docs(sample_dir())


def spec(width=8, canon="alnum", D=20):
    return AnchorSpec(density=D, ctx=ContextSpec(width=width, canon=canon))


# ---------------------------------------------------------------- primitives

def test_prf_is_length_framed():
    """Without framing, ('ab','c') and ('a','bc') collide and silently merge
    two distinct addresses into one equation."""
    assert prf(KEY, b"ab", b"c") != prf(KEY, b"a", b"bc")


def test_anchor_density_matches_D():
    """The fraction of gaps that fire should track 1/D, or the whole
    misaddressing-suppression argument is unfounded."""
    for D in (4, 20, 64):
        fired = total = 0
        for doc in DOCS:
            s = spec(D=D)
            for gap in range(doc.n_gaps):
                ctx = s.ctx.context_at(doc.tokens, gap)
                if ctx is None:
                    continue
                total += 1
                fired += s.fires(KEY, ctx)
        rate = fired / total
        assert 0.4 / D < rate < 2.5 / D, (D, rate)


def test_context_window_edges_return_none():
    d = parse("one two three four five")
    s = ContextSpec(width=8)
    assert s.context_at(d.tokens, 2) is None
    assert ContextSpec(width=2).context_at(d.tokens, 2) is not None


# ---------------------------------------------------------------- channels

def test_identity_is_lossless():
    for doc in DOCS:
        t = measure_one(doc, KEY, spec(), identity(), random.Random(0))
        assert t.placed == t.exact
        assert t.q == 1.0 and t.misaddressed == 0 and t.lost == 0


def test_reorder_preserves_every_carrier():
    """Paragraph reordering must not lose a single mark: that is the property
    the whole synchronisation-free argument rests on."""
    for doc in DOCS:
        t = measure_one(doc, KEY, spec(), reorder_paragraphs(), random.Random(1))
        assert t.lost == 0, doc.doc_id
        assert t.sigma_block == 1.0


def _q(canon, channel, seed=2):
    t = Tally()
    for doc in DOCS:
        t.add(measure_one(doc, KEY, spec(canon=canon), channel, random.Random(seed)))
    return t.q


def test_normalisation_absorbs_case_and_punctuation():
    """alnum and above must be exactly free under cosmetic change, or the
    canonicalisation is not doing its job."""
    for canon in ("alnum", "stem", "skeleton"):
        assert _q(canon, compose(recase(), repunctuate())) == 1.0, canon


def test_raw_is_strictly_worse_under_repunctuation():
    """`raw` keeps punctuation, so quote and dash substitution must cost it
    something.  Note that title-casing alone is free even for `raw`: NFKC plus
    casefold round-trips it.  That is why this test isolates punctuation."""
    assert _q("raw", repunctuate()) < _q("alnum", repunctuate()) == 1.0


def test_thinning_only_erases_never_misaddresses():
    """No visible token changes, so every surviving carrier must still be
    correctly addressed.  A failure here means marks are moving."""
    t = Tally()
    for doc in DOCS:
        t.add(measure_one(doc, KEY, spec(), thin(0.3), random.Random(3)))
    assert t.misaddressed == 0
    assert 0.55 < t.sigma_block < 0.85


def test_splice_inserts_runs_not_single_tokens():
    """Token-level interleaving would destroy every left-context; run-level
    insertion must not.  This guards the bug the first draft had."""
    vocab = vocabulary(DOCS)
    t = Tally()
    for doc in DOCS:
        t.add(measure_one(doc, KEY, spec(), splice_foreign(vocab[::3], 0.3),
                          random.Random(4)))
    assert t.sigma_block == 1.0          # pure insertion loses nothing
    assert t.q > 0.6, t.q


def test_reword_produces_misaddressing_at_roughly_the_predicted_rate():
    """q should track (1 - token change rate) ** width, and the observed
    misaddress rate among accepted should sit near (1-q)/D."""
    vocab = vocabulary(DOCS)
    t = Tally()
    for doc in DOCS:
        t.add(measure_one(doc, KEY, spec(width=8, D=20),
                          reword(vocab, 0.10), random.Random(5)))
    assert 0.3 < t.q < 0.9
    assert t.misaddressed > 0
    assert t.refire < 0.35, t.refire      # generous bound around 1/20


def test_crop_loses_carriers_in_proportion():
    t = Tally()
    for doc in DOCS:
        t.add(measure_one(doc, KEY, spec(), crop(0.5), random.Random(6)))
    assert 0.35 < t.sigma_block < 0.65


def test_mark_ids_are_never_duplicated_or_invented():
    doc = DOCS[0]
    sites = find_sites(doc, KEY, spec())
    md = place(doc, [s.gap for s in sites], per_site=3)
    placed = {m for s in md.slots for m in s.marks} | set(md.tail_marks)
    assert len(placed) == 3 * len(sites)
    damaged = compose(crop(0.6), reword(vocabulary(DOCS), 0.1))(md, random.Random(7))
    after = {m for s in damaged.slots for m in s.marks} | set(damaged.tail_marks)
    assert after <= placed                       # nothing invented
    counts = [m for s in damaged.slots for m in s.marks] + list(damaged.tail_marks)
    assert len(counts) == len(set(counts))       # nothing duplicated


# ---------------------------------------------------------------- alignment

def test_gap_map_identity():
    toks = "a b c d e f".split()
    gm = gap_map(toks, toks)
    assert all(gm[i] == i for i in range(len(toks) + 1))


def test_gap_map_shifts_after_insertion():
    src = "a b c d".split()
    dst = "x y a b c d".split()
    gm = gap_map(src, dst)
    assert gm[0] == 2 and gm[4] == 6


def test_gap_map_drops_deleted_region():
    src = "a b c d e".split()
    dst = "a e".split()
    gm = gap_map(src, dst)
    assert gm[0] == 0
    assert 2 not in gm or gm[2] != 2


def test_measure_pair_agrees_with_identity():
    txt = DOCS[0]
    raw = " ".join(txt.tokens)
    t = measure_pair(Pair(raw, raw), KEY, spec())
    assert t.placed == t.exact and t.misaddressed == 0


def test_edit_magnitude_bounds():
    raw = " ".join(DOCS[0].tokens)
    assert edit_magnitude(Pair(raw, raw)) == 0.0
    assert edit_magnitude(Pair(raw, "completely different text entirely")) > 0.9


# ---------------------------------------------------------------- model

def test_optimal_cluster_matches_brute_force():
    for u in (5, 11, 19, 26, 42, 80):
        for r in (0.001, 0.002, 0.005, 0.01, 0.03, 0.05, 0.1, 0.2):
            assert abs(optimal_cluster(u, r) - optimal_cluster_bruteforce(u, r)) <= 1.0


def test_optimal_cluster_diverges_without_thinning():
    assert optimal_cluster(19, 0.0) == float("inf")


def test_q_breakeven_matches_the_closed_form_costs():
    """q* is where cost_context(q) == cost_self, exactly, before rounding."""
    pl = Payload()
    for D in (8, 20, 64):
        for c in (4, 8, 16):
            sec = Security(density_D=D, n_anchor_sites=400)
            v_s = sec.v_required(pl.n_obs(), anchor_filtered=False)
            v_c = max(0, v_s - int(math.floor(math.log2(D))))
            qb = q_breakeven(c, sec, pl, seed_bits=10)
            cost_ctx = (c + v_c) / (c * qb)
            cost_self = (10 + c + v_s) / c
            assert cost_ctx == pytest.approx(cost_self, rel=1e-9), (D, c)


def test_discrete_designs_cross_near_q_star():
    """The integer block counts must agree with the algebra to within the
    rounding, or the model and the closed form have drifted apart."""
    pl, car = Payload(), Carrier()
    for D in (8, 20, 64):
        for c in (4, 8, 16):
            sec = Security(density_D=D, n_anchor_sites=400)
            qb = q_breakeven(c, sec, pl, seed_bits=10)
            for q, expect_ctx_cheaper in ((min(0.99, qb + 0.2), True),
                                          (max(0.05, qb - 0.2), False)):
                d = Damage(sigma_block=1.0, q=q)
                ctx = design_coded(pl, car, sec, d, c, "context")
                slf = design_coded(pl, car, sec, d, c, "self", seed_bits=10)
                # Compare continuous cost per usable observation.  Block
                # counts are integers and with large c only a handful of
                # blocks are needed, so rounding alone can invert the order.
                cc = ctx.block_bits / (c * ctx.detail["p_block"])
                cs = slf.block_bits / (c * slf.detail["p_block"])
                assert (cc < cs) == expect_ctx_cheaper, (D, c, q, cc, cs)


def test_more_damage_never_costs_less():
    pl, car = Payload(), Carrier()
    sec = Security(density_D=20, n_anchor_sites=400)
    prev = 0.0
    for sigma in (1.0, 0.8, 0.6, 0.4, 0.2, 0.1):
        d = design_coded(pl, car, sec, Damage(sigma_block=sigma, q=0.9), 8, "context")
        assert d.total_chars >= prev
        prev = d.total_chars


def test_contamination_never_helps_the_soft_path():
    """The bug that motivated this test: binary entropy is symmetric, so
    treating contamination as bit-flips rather than random constraints made a
    destroyed channel look pristine."""
    pl, car = Payload(), Carrier()
    sec = Security(density_D=20, n_anchor_sites=400)
    prev = 0
    for foreign in (0, 250, 500, 1000, 2000, 4000, 8000):
        d = design_soft(pl, car, sec,
                        Damage(sigma_block=0.5, q=0.8, foreign_carriers=foreign))
        cur = d.detail.get("carriers", math.inf) if d.total_chars else math.inf
        assert cur >= prev, (foreign, cur, prev)
        prev = cur


def test_bsc_crossover_never_exceeds_one_half():
    pl, car = Payload(), Carrier()
    sec = Security(density_D=2, n_anchor_sites=400)
    for q in (0.9, 0.5, 0.1, 0.01):
        for foreign in (0, 10_000):
            d = design_soft(pl, car, sec,
                            Damage(sigma_block=0.5, q=q, foreign_carriers=foreign))
            p = d.detail.get("p_bsc")
            if p is not None:
                assert 0.0 <= p <= 0.5 + 1e-9, (q, foreign, p)


def test_monolithic_dies_exponentially_in_payload_under_thinning():
    """The central asymmetry: block length enters the exponent for monolithic
    packets and does not for coded observations."""
    car, sec = Carrier(), Security(density_D=20, n_anchor_sites=2000)
    dmg = Damage(sigma_block=1.0, q=0.95, thin_rate=0.02)
    ratios = []
    for k_id in (48, 128, 256):
        pl = Payload(k_id=k_id)
        mono = design_monolithic(pl, car, sec, dmg)
        ctx = design_coded(pl, car, sec, dmg, 8, "context")
        ratios.append(mono.total_chars / ctx.total_chars)
    assert ratios[0] < ratios[1] < ratios[2]
    assert ratios[-1] > 5 * ratios[0]


def test_coset_slack_is_bounded_by_the_tag():
    assert Payload(mode="tag", tau=32, eps_false=1e-6).slack_d <= 32
    assert Payload(mode="tag", tau=0, eps_false=1e-6).slack_d == 0


def test_entropy_helper():
    assert h2(0.5) == pytest.approx(1.0)
    assert h2(0.0) == 0.0 and h2(1.0) == 0.0
    assert h2(0.1) == pytest.approx(h2(0.9))


def test_validation_discount_applied_exactly_once():
    """Regression: design_coded once subtracted log2(D) on top of the discount
    v_required had already applied, pricing context blocks four bits under what
    the closed form assumes.  The two must agree exactly."""
    pl = Payload()
    for D in (4, 8, 20, 64, 256):
        for sites in (50, 200, 400, 2000):
            sec = Security(density_D=D, n_anchor_sites=sites)
            d = design_coded(pl, Carrier(), sec, Damage(), 8, "context")
            assert d.detail["v"] == sec.v_required(pl.n_obs(), anchor_filtered=True), (D, sites)
            assert d.block_bits == 8 + d.detail["v"]


def test_seed_sizing_is_derived_not_guessed():
    from cauf.model import required_seed_bits
    assert required_seed_bits(256, "sequential") == 8
    assert required_seed_bits(1000, "sequential") == 10
    # random allocation is far more expensive; the design must say which it uses
    assert required_seed_bits(1000, "random") > required_seed_bits(1000, "sequential") + 6


def test_rng_seeding_is_stable_across_processes():
    import subprocess, sys as _s
    cmd = [_s.executable, "-c",
           "import sys; sys.path.insert(0,'src');"
           "from cauf.measure import stable_seed; print(stable_seed(0,'a','b',1))"]
    root = str(Path(__file__).resolve().parents[1])
    outs = {subprocess.run(cmd, capture_output=True, text=True, cwd=root).stdout
            for _ in range(3)}
    assert len(outs) == 1, outs


def test_gf2_rank_basics():
    from cauf.anchors import gf2_rank
    assert gf2_rank([0b001, 0b010, 0b100]) == 3
    assert gf2_rank([0b011, 0b110, 0b101]) == 2      # third is the XOR
    assert gf2_rank([0b101, 0b101, 0b101]) == 1      # duplicate addresses
    assert gf2_rank([]) == 0


def test_duplicate_addresses_do_not_add_rank():
    """The reason rank is reported instead of entropy: identical contexts
    generate identical coefficient vectors and contribute nothing."""
    from cauf.anchors import coefficient_vector, gf2_rank
    vs = [coefficient_vector(KEY, b"same context", 0, 64) for _ in range(20)]
    assert gf2_rank(vs) == 1


def test_sparse_vectors_reach_full_rank_more_slowly():
    """Sparsity is what a BP decoder needs and what costs rank; the soft path
    depends on the first and the model's n_obs assumes the absence of the
    second."""
    from cauf.anchors import coefficient_vector, gf2_rank
    k, n = 64, 96
    dense = [coefficient_vector(KEY, f"c{i}".encode(), 0, k) for i in range(n)]
    sparse = [coefficient_vector(KEY, f"c{i}".encode(), 0, k, sparse_degree=3)
              for i in range(n)]
    assert gf2_rank(dense) == k
    assert gf2_rank(sparse) < k


def test_q_breakeven_falls_with_thinning():
    """q* is channel-dependent.  Self-addressed blocks are longer by s plus
    the validation the anchor would have supplied, so carrier loss penalises
    them disproportionately.  Round-two review; matches by hand to 4 digits."""
    sec = Security(density_D=20, n_anchor_sites=400)
    pl = Payload()
    vals = [q_breakeven(8, sec, pl, 10, thin_rate=r, carrier=Carrier())
            for r in (0.0, 0.01, 0.02, 0.05)]
    assert vals == [pytest.approx(v, abs=5e-4)
                    for v in (0.6316, 0.5487, 0.4760, 0.3080)]
    assert vals[0] > vals[1] > vals[2] > vals[3]


def test_q_breakeven_thinning_matches_the_cost_ratio():
    """Cross-check against the discrete designs rather than the formula."""
    sec = Security(density_D=20, n_anchor_sites=400)
    pl, car = Payload(), Carrier()
    for r in (0.0, 0.01, 0.03):
        qs = q_breakeven(8, sec, pl, 10, thin_rate=r, carrier=car)
        for q, expect in ((min(0.999, qs + 0.02), True),
                          (max(0.01, qs - 0.02), False)):
            d = Damage(sigma_block=1.0, q=q, thin_rate=r)
            ctx = design_coded(pl, car, sec, d, 8, "context")
            slf = design_coded(pl, car, sec, d, 8, "self", seed_bits=10)
            cc = ctx.block_bits / (8 * ctx.detail["p_block"])
            cs = slf.block_bits / (8 * slf.detail["p_block"])
            assert (cc < cs) == expect, (r, q, cc, cs)


def test_self_address_capacity_is_enforced():
    """A 10-bit sequential address labels 1024 blocks and no more."""
    sec = Security(density_D=20, n_anchor_sites=400)
    pl, car = Payload(k_id=256, tau=32), Carrier()
    heavy = Damage(sigma_block=0.02, q=1.0, thin_rate=0.05)
    d = design_coded(pl, car, sec, heavy, 8, "self", seed_bits=10)
    assert d.total_chars is None
    assert d.detail["addr_capacity"] == 1024
    assert d.detail["blocks_wanted"] > 1024
    # widening the address field makes the same design feasible again
    d2 = design_coded(pl, car, sec, heavy, 8, "self", seed_bits=20)
    assert d2.total_chars is not None


def test_cli_optimal_cluster_uses_the_single_discount():
    """The CLI recomputed v and subtracted log2(D) a second time; that was the
    same bug as design_coded's, at a site the first fix missed."""
    import io, contextlib
    from cauf.cli import main
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        main(["model", "--thin", "0.02", "--density", "20", "--c", "8"])
    out = buf.getvalue()
    sec = Security(density_D=20, n_anchor_sites=200)
    expect = optimal_cluster_bruteforce(
        sec.v_required(Payload().n_obs(), anchor_filtered=True), 0.02)
    assert f"{expect} (brute force)" in out, (expect, out)
