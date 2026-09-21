"""Command line.

    python -m cauf stability  [--corpus DIR] [--out results.csv]
    python -m cauf pairs      --corpus DIR | --wikipedia TITLE,TITLE
    python -m cauf model      [--q 0.6] [--sigma 0.3] [--thin 0.01]
    python -m cauf decide     --results results.csv
"""

from __future__ import annotations

import argparse
import random
import sys
from typing import List, Sequence

from .anchors import AnchorSpec
from .channels import standard_suite
from .corpora import (load_dir_docs, load_dir_pairs, fetch_wikipedia_pairs,
                      sample_dir, vocabulary)
from .measure import measure, to_rows, write_csv
from .model import (Carrier, Damage, Payload, Security, compare, feasible,
                    optimal_cluster, optimal_cluster_bruteforce, q_breakeven)
from .text import ContextSpec, Doc

KEY = b"cauf-stability-experiment-key-do-not-use-in-production"

DEFAULT_WIDTHS = (2, 4, 8, 16, 32)
DEFAULT_CANONS = ("raw", "alnum", "stem", "skeleton", "initials")
DEFAULT_DENSITIES = (1, 8, 20, 64)


def build_specs(widths: Sequence[int] = DEFAULT_WIDTHS,
                canons: Sequence[str] = DEFAULT_CANONS,
                densities: Sequence[int] = DEFAULT_DENSITIES,
                sides: Sequence[str] = ("left",)) -> List[AnchorSpec]:
    out = []
    for D in densities:
        for canon in canons:
            for w in widths:
                for side in sides:
                    out.append(AnchorSpec(density=D,
                                          ctx=ContextSpec(width=w, canon=canon,
                                                          side=side)))
    return out


def _load_docs(path: str | None) -> List[Doc]:
    docs = load_dir_docs(path or sample_dir())
    if not docs:
        raise SystemExit(f"no .txt documents found in {path or sample_dir()}")
    return docs


def cmd_stability(args: argparse.Namespace) -> int:
    docs = _load_docs(args.corpus)
    vocab = vocabulary(docs)
    foreign = vocab[::3]
    specs = build_specs(
        widths=tuple(int(x) for x in args.widths.split(",")),
        canons=tuple(args.canons.split(",")),
        densities=tuple(int(x) for x in args.densities.split(",")),
        sides=tuple(args.sides.split(",")),
    )
    channels = standard_suite(vocab, foreign)
    if args.channels:
        wanted = set(args.channels.split(","))
        channels = {k: v for k, v in channels.items() if k in wanted}
    res = measure(docs, KEY, specs, channels, seed=args.seed,
                  per_site=args.per_site)
    rows = to_rows(res)
    if args.out:
        write_csv(rows, args.out)
        print(f"wrote {len(rows)} rows to {args.out}", file=sys.stderr)
    else:
        _print_table(rows, args.sort)
    return 0


def cmd_pairs(args: argparse.Namespace) -> int:
    from .align import bin_pairs, measure_pairs
    if args.wikipedia:
        pairs = fetch_wikipedia_pairs(args.wikipedia.split(","),
                                      per_title=args.per_title,
                                      cache_dir=args.cache)
    else:
        pairs = load_dir_pairs(args.corpus or sample_dir())
    if not pairs:
        raise SystemExit("no revision pairs found")
    specs = build_specs(
        widths=tuple(int(x) for x in args.widths.split(",")),
        canons=tuple(args.canons.split(",")),
        densities=tuple(int(x) for x in args.densities.split(",")),
    )
    rows = []
    for bin_name, group in sorted(bin_pairs(pairs).items()):
        for label, tally in measure_pairs(group, KEY, specs).items():
            row = {"bin": bin_name, "n_pairs": len(group), "spec": label}
            row.update(tally.summary())
            rows.append(row)
    if args.out:
        write_csv(rows, args.out)
        print(f"wrote {len(rows)} rows to {args.out}", file=sys.stderr)
    else:
        _print_table(rows, args.sort)
    return 0


def cmd_model(args: argparse.Namespace) -> int:
    payload = Payload(mode=args.mode, k_id=args.k_id, tau=args.tau,
                      roster=args.roster)
    carrier = Carrier(bits_per_char=args.bits_per_char)
    sec = Security(density_D=args.density, n_anchor_sites=args.sites)
    dmg = Damage(sigma_block=args.sigma, q=args.q, thin_rate=args.thin,
                 foreign_carriers=args.foreign)
    designs = compare(payload, carrier, sec, dmg, c=args.c,
                      seed_bits=args.seed_bits, words=args.words)

    print(f"payload k={payload.k} bits (mode={payload.mode}), "
          f"coset slack d={payload.slack_d}, observations needed="
          f"{payload.n_obs()}")
    print(f"damage: sigma_block={dmg.sigma_block} q={dmg.q} "
          f"thin={dmg.thin_rate} foreign={dmg.foreign_carriers}")
    print()
    hdr = f"{'design':<24}{'block bits':>11}{'blocks':>9}{'chars':>10}{'chars/1k words':>16}  detail"
    print(hdr)
    print("-" * len(hdr))
    for name, d in designs.items():
        cpk = d.chars_per_1000_words(args.words)
        print(f"{d.name:<24}{d.block_bits:>11}"
              f"{(d.blocks_needed if d.blocks_needed is not None else '-'):>9}"
              f"{(f'{d.total_chars:.0f}' if d.total_chars else '-'):>10}"
              f"{(f'{cpk:.2f}' if cpk else '-'):>16}  {d.detail}")
    print()
    qb = q_breakeven(args.c, sec, payload, args.seed_bits,
                     thin_rate=args.thin, carrier=carrier)
    print(f"q* (context beats self addressing above this) = {qb:.3f}")
    if args.thin > 0:
        v = sec.v_required(payload.n_obs(), anchor_filtered=True)
        c_star = optimal_cluster(max(0, v), args.thin)
        c_bf = optimal_cluster_bruteforce(max(1, v), args.thin)
        print(f"optimal cluster payload c* = {c_star:.1f} (closed form), "
              f"{c_bf} (brute force)")
    for _, d in designs.items():
        if d.needs_address and not feasible(d, args.words, sec):
            print(f"INFEASIBLE: {d.name} needs {d.blocks_needed} anchor sites, "
                  f"a {args.words}-word document supplies "
                  f"~{args.words // sec.density_D}")
    return 0


def cmd_decide(args: argparse.Namespace) -> int:
    import csv
    payload = Payload(mode=args.mode, k_id=args.k_id, tau=args.tau)
    carrier = Carrier(bits_per_char=args.bits_per_char)
    rows = list(csv.DictReader(open(args.results)))
    out = []
    for r in rows:
        D = int(r["spec"].split(":")[0][1:])
        sec = Security(density_D=D, n_anchor_sites=max(20, args.words // D))
        dmg = Damage(sigma_block=float(r["sigma_block"]), q=float(r["q"]),
                     thin_rate=args.thin, foreign_carriers=args.foreign)
        qb = q_breakeven(args.c, sec, payload, args.seed_bits,
                         thin_rate=args.thin, carrier=carrier)
        designs = compare(payload, carrier, sec, dmg, c=args.c,
                          seed_bits=args.seed_bits, words=args.words)
        priced = {k: v for k, v in designs.items()
                  if v.total_chars is not None
                  and feasible(v, args.words, sec, float(r["collision_rate"]))}
        best = min(priced.items(), key=lambda kv: kv[1].total_chars) if priced else None
        out.append({
            "spec": r["spec"], "channel": r["channel"],
            "q": r["q"], "q_star": f"{qb:.3f}",
            "addressing": "context" if float(r["q"]) >= qb else "self",
            "best_design": best[0] if best else "none feasible",
            "chars": f"{best[1].total_chars:.0f}" if best else "-",
            "chars_per_1k": (f"{best[1].chars_per_1000_words(args.words):.1f}"
                             if best else "-"),
        })
    if args.out:
        write_csv(out, args.out)
        print(f"wrote {len(out)} rows to {args.out}", file=sys.stderr)
    else:
        _print_table(out, None)
    return 0


def _print_table(rows, sort_key: str | None) -> None:
    if not rows:
        print("(no rows)")
        return
    if sort_key and sort_key in rows[0]:
        rows = sorted(rows, key=lambda r: r[sort_key], reverse=True)
    keys = list(rows[0].keys())
    widths = {k: max(len(str(k)), max(len(str(r[k])) for r in rows)) for k in keys}
    print("  ".join(str(k).ljust(widths[k]) for k in keys))
    print("  ".join("-" * widths[k] for k in keys))
    for r in rows:
        print("  ".join(str(r[k]).ljust(widths[k]) for k in keys))


def main(argv: Sequence[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="cauf")
    sub = p.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("stability", help="synthetic-channel sweep")
    s.add_argument("--corpus")
    s.add_argument("--out")
    s.add_argument("--widths", default="4,8,16,32")
    s.add_argument("--canons", default="alnum,stem,skeleton")
    s.add_argument("--densities", default="1,20")
    s.add_argument("--sides", default="left")
    s.add_argument("--channels", default="")
    s.add_argument("--per-site", type=int, default=1, dest="per_site")
    s.add_argument("--seed", type=int, default=0)
    s.add_argument("--sort", default=None)
    s.set_defaults(func=cmd_stability)

    r = sub.add_parser("pairs", help="real revision pairs")
    r.add_argument("--corpus")
    r.add_argument("--wikipedia", help="comma-separated article titles")
    r.add_argument("--per-title", type=int, default=6, dest="per_title")
    r.add_argument("--cache", default=".wikicache")
    r.add_argument("--out")
    r.add_argument("--widths", default="4,8,16,32")
    r.add_argument("--canons", default="alnum,stem,skeleton")
    r.add_argument("--densities", default="20")
    r.add_argument("--sort", default=None)
    r.set_defaults(func=cmd_pairs)

    m = sub.add_parser("model", help="overhead model")
    m.add_argument("--mode", default="tag", choices=["tag", "roster"])
    m.add_argument("--k-id", type=int, default=48, dest="k_id")
    m.add_argument("--tau", type=int, default=32)
    m.add_argument("--roster", type=int, default=500)
    m.add_argument("--bits-per-char", type=float, default=1.0, dest="bits_per_char")
    m.add_argument("--density", type=int, default=20)
    m.add_argument("--sites", type=int, default=200)
    m.add_argument("--c", type=int, default=8)
    m.add_argument("--seed-bits", type=int, default=10, dest="seed_bits")
    m.add_argument("--sigma", type=float, default=1.0)
    m.add_argument("--q", type=float, default=1.0)
    m.add_argument("--thin", type=float, default=0.0)
    m.add_argument("--foreign", type=int, default=0)
    m.add_argument("--words", type=int, default=1000)
    m.set_defaults(func=cmd_model)

    dd = sub.add_parser("decide", help="apply the cost model to measured rates")
    dd.add_argument("--results", required=True)
    dd.add_argument("--mode", default="tag", choices=["tag", "roster"])
    dd.add_argument("--k-id", type=int, default=48, dest="k_id")
    dd.add_argument("--tau", type=int, default=32)
    dd.add_argument("--bits-per-char", type=float, default=1.0, dest="bits_per_char")
    dd.add_argument("--c", type=int, default=8)
    dd.add_argument("--seed-bits", type=int, default=10, dest="seed_bits")
    dd.add_argument("--thin", type=float, default=0.0)
    dd.add_argument("--foreign", type=int, default=0)
    dd.add_argument("--words", type=int, default=5000)
    dd.add_argument("--out")
    dd.set_defaults(func=cmd_decide)

    args = p.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
