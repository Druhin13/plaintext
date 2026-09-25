"""Context-addressed rateless fingerprinting: stability measurement and cost model.

Milestone 1 only.  Nothing here embeds or decodes a fingerprint.  The purpose is
to decide, before any encoder is written, whether an address derived from
mutable cover text survives realistic editing well enough to be worth using.
"""

__version__ = "0.1.0"

from . import align, anchors, channels, corpora, measure, model, text  # noqa: F401
from .anchors import AnchorSpec, find_sites  # noqa: F401
from .measure import Tally, measure as run_sweep  # noqa: F401
from .text import CANONICALISERS, ContextSpec, Doc, parse  # noqa: F401

__all__ = ["align", "anchors", "channels", "corpora", "measure", "model",
           "text", "AnchorSpec", "find_sites", "Tally", "run_sweep",
           "CANONICALISERS", "ContextSpec", "Doc", "parse"]
