"""Reproduces every number quoted in MODEL.md.  Run: python3 sweeps.py"""

from __future__ import annotations

import math
import sys

sys.path.insert(0, "src")

from cauf.model import (Carrier, Damage, Payload, Security, compare,
                        optimal_cluster, optimal_cluster_bruteforce,
                        q_breakeven, design_coded, design_monolithic,
                        design_indexed, design_soft, h2)

CAR = Carrier(bits_per_char=1.0)


def hr(title: str) -> None:
    print("\n" + title)
    print("=" * len(title))


def table(rows, headers):
    w = [max(len(str(h)), max((len(str(r[i])) for r in rows), default=0))
         for i, h in enumerate(headers)]
    print("  ".join(str(h).ljust(w[i]) for i, h in enumerate(headers)))
    print("  ".join("-" * w[i] for i in range(len(headers))))
    for r in rows:
        print("  ".join(str(c).ljust(w[i]) for i, c in enumerate(r)))


def fmt(x):
    return "-" if x is None else f"{x:.0f}"


# ---------------------------------------------------------------- 1
hr("1. Payload scaling at fixed damage (sigma=0.3, q=0.8, thin=1%)")
print("Carrier characters required for 99% recovery. 'ratio' = monolithic/coded-context.")
dmg = Damage(sigma_block=0.30, q=0.80, thin_rate=0.01)
sec = Security(density_D=20, n_anchor_sites=400)
rows = []
for k_id in (32, 48, 64, 96, 128, 192, 256, 384, 512):
    pl = Payload(mode="tag", k_id=k_id, tau=32)
    mono = design_monolithic(pl, CAR, sec, dmg)
    idx = design_indexed(pl, CAR, sec, dmg, chunk_bits=16)
    ctx = design_coded(pl, CAR, sec, dmg, c=8, addressing="context")
    slf = design_coded(pl, CAR, sec, dmg, c=8, addressing="self", seed_bits=10)
    ratio = (mono.total_chars / ctx.total_chars) if (mono.total_chars and ctx.total_chars) else None
    rows.append([k_id, fmt(mono.total_chars), fmt(idx.total_chars),
                 fmt(slf.total_chars), fmt(ctx.total_chars),
                 "-" if ratio is None else f"{ratio:.1f}x"])
table(rows, ["payload id bits", "monolithic", "indexed", "coded-self",
             "coded-context", "ratio"])

# ---------------------------------------------------------------- 2
hr("2. Thinning sensitivity at fixed payload (k_id=128, sigma=1.0, q=0.9)")
print("Independent per-carrier loss. This is where block length enters the exponent.")
rows = []
pl = Payload(mode="tag", k_id=128, tau=32)
for r in (0.0, 0.005, 0.01, 0.02, 0.05, 0.10):
    d = Damage(sigma_block=1.0, q=0.9, thin_rate=r)
    mono = design_monolithic(pl, CAR, sec, d)
    idx = design_indexed(pl, CAR, sec, d, chunk_bits=16)
    ctx = design_coded(pl, CAR, sec, d, c=8, addressing="context")
    rows.append([f"{r:.3f}", fmt(mono.total_chars), fmt(idx.total_chars),
                 fmt(ctx.total_chars)])
table(rows, ["thin rate", "monolithic", "indexed", "coded-context(c=8)"])

# ---------------------------------------------------------------- 3
hr("3. Optimal cluster payload c*: closed form vs brute force")
print("c* = (-u + sqrt(u^2 + 4u/alpha))/2,  alpha = -ln(1-r),  u = fixed block overhead")
rows = []
for u in (11, 19, 26, 42):
    for r in (0.002, 0.01, 0.05, 0.10):
        cf = optimal_cluster(u, r)
        bf = optimal_cluster_bruteforce(u, r)
        rows.append([u, r, f"{cf:.1f}", bf, "ok" if abs(cf - bf) <= 1.0 else "MISMATCH"])
table(rows, ["overhead u (bits)", "thin rate", "c* closed form", "c* brute force", ""])

# ---------------------------------------------------------------- 4
hr("4. Break-even address survival q*")
print("Context addressing beats self addressing iff measured q exceeds q*.")
print("q* = (c + v_c)/(s + c + v_s),  v_c = V - log2(D),  v_s = V")
rows = []
pl = Payload(mode="tag", k_id=48, tau=32)
for D in (8, 20, 64, 256):
    for c in (4, 8, 16, 32):
        s = Security(density_D=D, n_anchor_sites=400)
        rows.append([D, c, f"{q_breakeven(c, s, pl, seed_bits=10):.3f}"])
table(rows, ["anchor density D", "cluster c", "q*"])

# ---------------------------------------------------------------- 5
hr("5. Soft decoding: where the BSC path beats the validated path, and where it dies")
print("Soft = no per-block MAC, misaddressing decoded as noise. Contamination = foreign")
print("invisible characters already in the document (another watermark, for instance).")
rows = []
pl = Payload(mode="tag", k_id=48, tau=32)
for q in (0.95, 0.8, 0.6, 0.4):
    for foreign in (0, 500, 2000, 4000):
        d = Damage(sigma_block=0.5, q=q, thin_rate=0.0, foreign_carriers=foreign)
        soft = design_soft(pl, CAR, sec, d)
        ctx = design_coded(pl, CAR, sec, d, c=8, addressing="context")
        rows.append([q, foreign, fmt(soft.total_chars),
                     soft.detail.get("p_bsc", "-"), fmt(ctx.total_chars)])
table(rows, ["q", "foreign chars", "soft chars", "p_bsc", "validated chars"])

# ---------------------------------------------------------------- 6
hr("6. Anchor supply: the constraint self-addressing does not have")
print("Context addressing can only mark one gap in D. Blocks needed vs sites available.")
rows = []
pl = Payload(mode="tag", k_id=128, tau=32)
d = Damage(sigma_block=0.3, q=0.8, thin_rate=0.01)
for words in (500, 1000, 2000, 5000, 10000):
    for D in (8, 20, 64):
        s = Security(density_D=D, n_anchor_sites=max(20, words // D))
        ctx = design_coded(pl, CAR, s, d, c=8, addressing="context")
        sites = words // D
        ok = "yes" if ctx.blocks_needed and ctx.blocks_needed <= sites else "NO"
        rows.append([words, D, ctx.blocks_needed, sites, ok])
table(rows, ["words", "D", "blocks needed", "sites available", "fits"])

# ---------------------------------------------------------------- 7
hr("7. Roster mode: no in-band tag when the recipient set is known")
rows = []
for mode, roster in (("tag", 0), ("roster", 500), ("roster", 50000)):
    pl = Payload(mode=mode, k_id=48 if mode == "tag" else 40, tau=32,
                 roster=roster or 1, eps_false=1e-6)
    d = Damage(sigma_block=0.3, q=0.8, thin_rate=0.01)
    ctx = design_coded(pl, CAR, sec, d, c=8, addressing="context")
    rows.append([mode, roster or "-", pl.k, pl.slack_d, pl.n_obs(),
                 fmt(ctx.total_chars)])
table(rows, ["mode", "roster", "k bits", "coset slack d", "observations",
             "coded-context chars"])

# ---------------------------------------------------------------- 8
hr("8. RANSAC feasibility check (why unvalidated dense decoding is not an option)")
print("Expected trials to draw k+margin clean equations at misaddressing rate p.")
rows = []
n = 78
for p in (0.05, 0.10, 0.21, 0.30, 0.51):
    trials = (1 - p) ** (-n)
    rows.append([p, n, f"{trials:.3g}"])
table(rows, ["p (misaddress rate)", "clean sample size", "expected trials"])
print("\nGlyphmark's published anchor table gives region-change rates of 0.21 at")
print("40-char windows / 20% deletion and 0.51 at 100-char windows / 20% deletion.")
print("Both are already out of reach, so validation bits are mandatory, not optional.")
