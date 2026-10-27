#!/usr/bin/env python3
"""Install the current dot-skill repo into the local Codex skill directory."""

from __future__ import annotations

import argparse
import os
import shutil
import tempfile
from pathlib import Path
# The scripts say UTF-8, whatever the machine's locale is.
#
# These print Chinese — their help, their errors, their findings — and
# a C locale would make the standard streams ASCII, so printing a
# single Chinese character raises UnicodeEncodeError and the script
# dies on its own output. Importing the shared module configures the
# streams, and it has to happen before anything is printed.
import collector_common  # noqa: F401



IGNORE_NAMES = shutil.ignore_patterns(".git", "__pycache__", ".DS_Store", "*.pyc")


def install_skill(source: Path, destination: Path, force: bool = False, dry_run: bool = False) -> Path:
    """Copy the repo into the Codex local skill directory."""
    if not (source / "SKILL.md").exists():
        raise FileNotFoundError(f"source does not look like a skill repo: {source}")

    if dry_run:
        return destination

    if destination.exists() and not force:
        raise FileExistsError(f"destination already exists: {destination}")

    destination.parent.mkdir(parents=True, exist_ok=True)

    # 先在旁边写好一份，再换上去。
    #
    # 原来的写法是先删掉旧的再复制新的：复制到一半失败了（磁盘满了、
    # 权限不对、进程被杀掉），旧的那份已经没了，而新的那份从来没有
    # 复制完——用户手里的技能就这么没了。
    staging = Path(tempfile.mkdtemp(prefix=f".{destination.name}.new-", dir=str(destination.parent)))
    backup = destination.parent / f".{destination.name}.old-{os.getpid()}"
    try:
        shutil.copytree(source, staging, ignore=IGNORE_NAMES, dirs_exist_ok=True)
        if destination.exists():
            if backup.exists():
                shutil.rmtree(backup)
            destination.rename(backup)
        try:
            staging.rename(destination)
        except Exception:
            if backup.exists() and not destination.exists():
                backup.rename(destination)
            raise
        if backup.exists():
            shutil.rmtree(backup, ignore_errors=True)
    finally:
        if staging.exists():
            shutil.rmtree(staging, ignore_errors=True)
    return destination


def main() -> None:
    parser = argparse.ArgumentParser(description="Install dot-skill into Codex")
    parser.add_argument(
        "--source",
        default=str(Path(__file__).resolve().parents[1]),
        help="Source skill repo root",
    )
    parser.add_argument(
        "--dest",
        default=str(Path.home() / ".codex" / "skills" / "dot-skill"),
        help="Destination Codex skill directory",
    )
    parser.add_argument("--force", action="store_true", help="Overwrite the destination if needed")
    parser.add_argument("--dry-run", action="store_true", help="Print the install target without copying")
    args = parser.parse_args()

    destination = install_skill(
        Path(args.source).expanduser(),
        Path(args.dest).expanduser(),
        force=args.force,
        dry_run=args.dry_run,
    )
    print(destination)


if __name__ == "__main__":
    main()
