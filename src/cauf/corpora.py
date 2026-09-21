"""Corpora.

Three sources, in increasing order of realism and decreasing order of
convenience:

  ``sample``      bundled prose, offline, for smoke tests only.  The numbers it
                  produces are not evidence of anything.
  ``dir``         a directory of ``*.before.txt`` / ``*.after.txt`` pairs, or
                  plain ``*.txt`` documents for the synthetic channels.
  ``wikipedia``   consecutive revision pairs pulled from the MediaWiki API.
                  Real human edits, millions available, free, and binnable by
                  edit magnitude.

Caveat that matters for the paper.  Wikipedia revisions are *authoring* edits.
The threat model is *redistribution*: crop, splice, reorder, paste elsewhere,
retype a sentence.  Those distributions are different and Wikipedia does not
contain the second one.  Wikipedia calibrates the magnitude of the context
mutation channel; the synthetic redistribution channels have to supply the
geometry.  Reporting one without the other would be misleading, so ``cli.py``
runs both by default.

Network note: the MediaWiki API is not reachable from every sandbox.  The
fetcher writes a cache directory so a fetch done once on a networked machine
can be replayed offline.
"""

from __future__ import annotations

import json
import re
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Iterable, List, Optional, Sequence

from .align import Pair
from .text import Doc, parse

USER_AGENT = "cauf-stability/0.1 (research; context-addressing measurement)"

_WIKI_MARKUP = [
    (re.compile(r"<ref[^>]*?/>", re.S), " "),
    (re.compile(r"<ref.*?</ref>", re.S), " "),
    (re.compile(r"<!--.*?-->", re.S), " "),
    (re.compile(r"\{\{[^{}]*\}\}"), " "),
    (re.compile(r"\[\[(?:[^\[\]|]*\|)?([^\[\]|]*)\]\]"), r"\1"),
    (re.compile(r"\[https?://\S+\s+([^\]]*)\]"), r"\1"),
    (re.compile(r"'{2,}"), ""),
    (re.compile(r"^[=*#:;].*$", re.M), " "),
    (re.compile(r"<[^>]+>"), " "),
    (re.compile(r"[ \t]+"), " "),
]


def strip_wikitext(text: str) -> str:
    prev = None
    while prev != text:
        prev = text
        for pat, rep in _WIKI_MARKUP:
            text = pat.sub(rep, text)
    lines = [ln.strip() for ln in text.splitlines()]
    return "\n\n".join(ln for ln in lines if len(ln.split()) >= 6)


def fetch_wikipedia_pairs(titles: Sequence[str], per_title: int = 6,
                          lang: str = "en", cache_dir: Optional[str] = None,
                          timeout: int = 30) -> List[Pair]:
    out: List[Pair] = []
    cache = Path(cache_dir) if cache_dir else None
    if cache:
        cache.mkdir(parents=True, exist_ok=True)
    api = f"https://{lang}.wikipedia.org/w/api.php"
    for title in titles:
        blob = None
        cpath = cache / (re.sub(r"\W+", "_", title) + ".json") if cache else None
        if cpath and cpath.exists():
            blob = json.loads(cpath.read_text())
        if blob is None:
            params = {
                "action": "query", "format": "json", "prop": "revisions",
                "titles": title, "rvprop": "ids|content|timestamp",
                "rvslots": "main", "rvlimit": str(per_title + 1),
                "formatversion": "2",
            }
            url = api + "?" + urllib.parse.urlencode(params)
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=timeout) as fh:
                blob = json.loads(fh.read().decode("utf-8"))
            if cpath:
                cpath.write_text(json.dumps(blob))
        for page in blob.get("query", {}).get("pages", []):
            revs = page.get("revisions", [])
            texts = []
            for r in revs:
                body = r.get("slots", {}).get("main", {}).get("content", "")
                texts.append((r.get("revid"), strip_wikitext(body)))
            texts.reverse()
            for (id0, t0), (id1, t1) in zip(texts, texts[1:]):
                if len(t0.split()) < 200 or len(t1.split()) < 200:
                    continue
                out.append(Pair(before=t0, after=t1,
                                pair_id=f"{title}:{id0}->{id1}"))
    return out


def load_dir_pairs(path: str) -> List[Pair]:
    root = Path(path)
    pairs = []
    for before in sorted(root.glob("*.before.txt")):
        after = before.with_name(before.name.replace(".before.", ".after."))
        if after.exists():
            pairs.append(Pair(before.read_text(), after.read_text(), before.stem))
    return pairs


def load_dir_docs(path: str) -> List[Doc]:
    root = Path(path)
    docs = []
    for p in sorted(root.glob("*.txt")):
        if ".before." in p.name or ".after." in p.name:
            continue
        docs.append(parse(p.read_text(), p.stem))
    return docs


def vocabulary(docs: Iterable[Doc]) -> List[str]:
    seen, out = set(), []
    for d in docs:
        for t in d.tokens:
            if t not in seen:
                seen.add(t)
                out.append(t)
    return out


def sample_dir() -> str:
    here = Path(__file__).resolve().parents[2] / "data" / "sample"
    return str(here)
