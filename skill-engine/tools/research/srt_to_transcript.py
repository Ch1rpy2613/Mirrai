#!/usr/bin/env python3
"""Convert subtitle files into clean transcript text."""

from __future__ import annotations

import argparse
import re
from pathlib import Path


TIMESTAMP_PATTERN = re.compile(
    r"^\s*(\d{2}:\d{2}:\d{2}[\.,]\d{3}|\d{2}:\d{2}[\.,]\d{3})\s+-->\s+"
)


def _strip_vtt_headers(content: str) -> str:
    content = re.sub(r"^WEBVTT.*?(?:\n\n|\r\n\r\n)", "", content, flags=re.DOTALL)
    content = re.sub(r"^NOTE.*?(?:\n\n|\r\n\r\n)", "", content, flags=re.DOTALL | re.MULTILINE)
    return content


def clean_subtitle_text(content: str) -> str:
    """Normalize subtitle content into readable transcript paragraphs."""
    content = _strip_vtt_headers(content)
    cleaned_lines: list[str] = []

    for raw_line in content.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        if line.isdigit():
            continue
        if TIMESTAMP_PATTERN.match(line):
            continue

        line = re.sub(r"<[^>]+>", "", line)
        line = re.sub(r"\b(?:align|position|size|line):[^\s]+", "", line).strip()
        line = re.sub(r"\s+", " ", line)
        if line:
            cleaned_lines.append(line)

    deduped: list[str] = []
    for line in cleaned_lines:
        if not deduped or deduped[-1] != line:
            deduped.append(line)

    paragraphs: list[str] = []
    current: list[str] = []
    for line in deduped:
        current.append(line)
        joined = " ".join(current)
        if len(joined) >= 240 or re.search(r"[.!?。！？]$", line):
            paragraphs.append(joined)
            current = []
    if current:
        paragraphs.append(" ".join(current))

    return "\n\n".join(paragraphs).strip()


def read_subtitle(path: Path) -> str:
    """
    读字幕文件——不管它是什么编码。

    它原来只读 UTF-8：一份 GB18030 的字幕抛 UnicodeDecodeError，整个转换
    死了，用户拿到的是"转换失败"，而不是一份字幕。

    字幕文件在中国很常见是 GB18030（Windows 的默认），所以这里按顺序试：
    UTF-8 先试（它有严格的规则，试不出来的就不是它），然后 GB18030，
    最后用 latin-1 兜底——它不会失败，代价是错的字。
    """
    raw = path.read_bytes()
    for encoding in ("utf-8-sig", "utf-8", "gb18030", "big5"):
        try:
            return raw.decode(encoding)
        except (UnicodeDecodeError, LookupError):
            continue
    # latin-1 不会失败——每一个字节都是它的字符。字可能是错的，但字幕
    # 至少读得出来，用户还能自己看。
    return raw.decode("latin-1")


def convert_file(input_path: Path, output_path: Path) -> Path:
    """Read a subtitle file and write a cleaned transcript."""
    transcript = clean_subtitle_text(read_subtitle(input_path))
    output_path.write_text(transcript + ("\n" if transcript else ""), encoding="utf-8")
    return output_path


def main() -> None:
    parser = argparse.ArgumentParser(description="Convert subtitles into transcript text")
    parser.add_argument("input", help="Path to a subtitle file (.srt or .vtt)")
    parser.add_argument(
        "output",
        nargs="?",
        help="Optional output path; defaults to <input>_transcript.txt",
    )
    args = parser.parse_args()

    input_path = Path(args.input).expanduser()
    if not input_path.exists():
        raise SystemExit(f"error: file not found: {input_path}")

    output_path = (
        Path(args.output).expanduser()
        if args.output
        else input_path.with_name(f"{input_path.stem}_transcript.txt")
    )
    written_path = convert_file(input_path, output_path)
    print(written_path)


if __name__ == "__main__":
    main()
