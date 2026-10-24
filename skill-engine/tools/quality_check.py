#!/usr/bin/env python3
"""Entry point for the celebrity quality gate.

The implementation lives in `tools/research/quality_check.py` together with
the other research tools, because the merge/quality pair belongs to the same
research toolchain. This module keeps the shorter `tools/quality_check.py`
path working for callers that import or execute it from the tools directory.
"""

from __future__ import annotations

import sys
from pathlib import Path

TOOLS_DIR = Path(__file__).resolve().parent
if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))

from research.quality_check import (  # noqa: E402,F401
    DEFAULT_RESEARCH_METRICS,
    evaluate_skill_text,
    is_copyright_safe_text,
    is_source_like_url,
    load_research_metrics,
    main,
    review_status_is_pass,
)
from skill_presets import get_quality_thresholds  # noqa: E402,F401


if __name__ == "__main__":
    main()
