#!/usr/bin/env python3
"""Build a self-hosted subset of MiSans for the web interface.

MiSans ships as a 20 MB variable TTF covering ~29 500 code points, and the
per-weight woff2 files are about 4.8 MB each. Shipping any of those whole
would put a five to twenty megabyte download in front of every page load.

So the font is subset: only the characters the interface actually renders
are kept, the weight axis stays intact, and every OpenType feature is
preserved so `tnum`, `frac`, `ss04` and friends keep working. The glyph
outlines themselves are never touched.

The character set is collected from three sources:
  1. every CJK character that appears literally in the client sources
  2. a fixed set of ASCII, CJK punctuation and symbols
  3. the extra code points that the font features substitute in — fractions,
     superscripts, the Latin-1 range and so on — so that turning a feature on
     never produces a missing glyph

Usage:
    python3 scripts/subset-misans.py [path/to/MiSansVF.ttf]
"""
import os
import re
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "client", "public", "fonts")
OUT_NAME = "MiSans-subset.woff2"

# Where the interface's words live.
#
# It used to be `client/src` only. But the interface reads a good part of
# its words out of `shared/` — the imperfection profiles, the relationship
# phases, the user's own moods — and those words have Chinese in them
# too. So a character that only appears there was not in the subset, and
# the interface showed a box where the word should have been.
SOURCE_DIRS = (
    os.path.join(ROOT, "client", "src"),
    os.path.join(ROOT, "shared"),
)

# The font to subset.
#
# It is not in the repository — it is a large file with its own licence —
# so its place is given on the command line or in the environment. The
# path that was written here was the maintainer's own home directory, so
# the script could only run on that one machine.
DEFAULT_SOURCE = os.environ.get("MIRRAI_MISANS_SOURCE", "")

# Characters the features substitute in. Without these, switching a feature
# on would swap a glyph for one that was not in the subset.
EXTRA = (
    "0123456789"
    "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    "abcdefghijklmnopqrstuvwxyz"
    " !\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~"
    "、。，．：；！？「」『』（）【】《》〈〉—…·～“”‘’〔〕"
    "￥＄€£¥¢№℡％‰°′″℃℉±×÷≈≠≤≥∞√∑∏∂∆∫∮"
    "①②③④⑤⑥⑦⑧⑨⑩⓪"
    "¹²³⁰⁴⁵⁶⁷⁸⁹"
    "₀₁₂₃₄₅₆₇₈₉"
    "½¼¾⅓⅔⅛⅜⅝⅞"
    "ⁿⁱ"
    "←→↑↓↔⇒⇐"
    "〇一二三四五六七八九十百千万亿零两"
    "abcdefghijklmnopqrstuvwxyz"
    "·—–‒―〜～"
)

CJK_RE = re.compile(r"[　-〿㐀-䶿一-鿿＀-￯]")


def collect() -> str:
    chars = set(EXTRA)
    for source_dir in SOURCE_DIRS:
        if not os.path.isdir(source_dir):
            continue
        for base, _dirs, files in os.walk(source_dir):
            for name in files:
                if not name.endswith((".ts", ".tsx", ".html")):
                    continue
                with open(os.path.join(base, name), encoding="utf-8", errors="ignore") as fh:
                    for ch in fh.read():
                        if CJK_RE.match(ch):
                            chars.add(ch)
    return "".join(sorted(chars))


def main() -> int:
    source = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_SOURCE
    if not source:
        print(
            "ERROR: no font to subset — pass the font as the first argument, "
            "or set MIRRAI_MISANS_SOURCE",
            file=sys.stderr,
        )
        return 1
    if not os.path.exists(source):
        print(f"ERROR: {source} not found", file=sys.stderr)
        return 1

    chars = collect()
    print(f"collected {len(chars)} characters")

    os.makedirs(OUT_DIR, exist_ok=True)
    out = os.path.join(OUT_DIR, OUT_NAME)

    # Where pyftsubset is.
    #
    # It was written down — so the script failed with a file-not-found
    # from the middle of a subprocess, on a machine that had it
    # somewhere else, or had it under a different name.
    subsetter = os.environ.get("MIRRAI_PYFTSUBSET", "").strip()
    if not subsetter:
        candidate = os.path.join(ROOT, ".live-test", "fontenv", "bin", "pyftsubset")
        subsetter = candidate if os.path.exists(candidate) else shutil.which("pyftsubset") or ""
    if not subsetter or not os.path.exists(subsetter):
        print(
            "ERROR: pyftsubset was not found — install fonttools, or set "
            "MIRRAI_PYFTSUBSET to the path of the pyftsubset binary",
            file=sys.stderr,
        )
        return 1

    cmd = [
        subsetter,
        source,
        f"--text={chars}",
        "--flavor=woff2",
        f"--output-file={out}",
        "--layout-features=*",
        "--name-IDs=1,2,3,4,5,6",
        "--drop-tables+=DSIG",
        "--passthrough-tables",
        "--notdef-outline",
        "--recommended-glyphs",
        "--name-legacy",
        "--name-languages=*",
    ]
    print("running:", " ".join(cmd[:3]), "...")
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(result.stdout)
        print(result.stderr, file=sys.stderr)
        return result.returncode

    size = os.path.getsize(out)
    print(f"wrote {out} ({size / 1024:.1f} KB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
