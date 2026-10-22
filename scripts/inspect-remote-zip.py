#!/usr/bin/env python3
"""Inspect a remote ZIP archive without downloading all of it.

Only the tail of the file is fetched, over HTTP range requests, and the
central directory is parsed from it. That makes it practical to check the
layout of a 300 MB archive in a couple of seconds.

    python3 scripts/inspect-remote-zip.py <url> [filter]

The filter is matched case-insensitively against the entry names. Without one,
the first entries are listed.

This is how the layout of the PostgreSQL Windows binaries was checked while
writing the Windows build: the archive unpacks into a top level "pgsql"
directory, and the DLLs that postgres.exe needs are already next to the
executables in bin\\, not in lib\\.
"""
import io
import os
import sys
import urllib.request
import zipfile

CHUNK = 1 << 20


class HttpFile(io.RawIOBase):
    """A read-only file-like object backed by HTTP range requests."""

    def __init__(self, url):
        self.url = url
        self.pos = 0
        request = urllib.request.Request(url, method="HEAD")
        with urllib.request.urlopen(request, timeout=30) as response:
            self.length = int(response.headers["Content-Length"])
        self._buf = b""
        self._buf_start = 0

    def readable(self):
        return True

    def seekable(self):
        return True

    def seek(self, offset, whence=io.SEEK_SET):
        if whence == io.SEEK_SET:
            self.pos = offset
        elif whence == io.SEEK_CUR:
            self.pos += offset
        else:
            self.pos = self.length + offset
        return self.pos

    def tell(self):
        return self.pos

    def _fetch(self, start, end):
        end = min(end, self.length - 1)
        if end < start:
            return b""
        request = urllib.request.Request(
            self.url, headers={"Range": f"bytes={start}-{end}"}
        )
        with urllib.request.urlopen(request, timeout=60) as response:
            return response.read()

    def read(self, size=-1):
        end = self.length - 1 if size is None or size < 0 else self.pos + size - 1
        if not (self._buf_start <= self.pos and end < self._buf_start + len(self._buf)):
            want = max(CHUNK, size if size and size > 0 else 0)
            self._buf = self._fetch(self.pos, self.pos + want - 1)
            self._buf_start = self.pos
        take_end = min(end, self._buf_start + len(self._buf) - 1)
        out = self._buf[self.pos - self._buf_start: take_end - self._buf_start + 1]
        self.pos = take_end + 1
        return out


def main(argv):
    if len(argv) < 2:
        print(__doc__)
        return 1

    url = argv[1]
    needle = argv[2].lower() if len(argv) > 2 else ""

    archive = zipfile.ZipFile(HttpFile(url))
    names = archive.namelist()
    print(f"total entries: {len(names)}")

    if not needle:
        for name in names[:60]:
            print("  ", name)
        return 0

    hits = [n for n in names if needle in n.lower()]
    print(f"matching '{needle}': {len(hits)}")
    for name in hits[:40]:
        print("  ", name)

    tops = sorted({n.split("/")[0] for n in names if n})
    print("top-level entries:", tops[:20])
    for top in tops[:4]:
        for sub in sorted({n for n in names if n.startswith(top + "/")})[:8]:
            print("    ", sub)

    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
