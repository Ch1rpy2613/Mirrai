#!/usr/bin/env python3
"""
Skill version manager.

This module archives and restores generated skill artifacts while keeping the
legacy colleague storage layout available.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from skill_presets import normalize_character, resolve_existing_storage_root
from skill_schema import PRIMARY_ARTIFACTS, enrich_skill_meta, now_iso, sync_legacy_fields
# The scripts say UTF-8, whatever the machine's locale is.
#
# These print Chinese — their help, their errors, their findings — and
# a C locale would make the standard streams ASCII, so printing a
# single Chinese character raises UnicodeEncodeError and the script
# dies on its own output. Importing the shared module configures the
# streams, and it has to happen before anything is printed.
import collector_common  # noqa: F401


MAX_VERSIONS = 10


def resolve_base_dir(base_dir_arg: str | None, character: str) -> Path:
    """Resolve the storage root for the selected character family."""
    return resolve_existing_storage_root(character, base_dir_arg=base_dir_arg)


def list_versions(skill_dir: Path) -> list[dict]:
    """List all archived versions for a skill directory."""
    versions_dir = skill_dir / "versions"
    if not versions_dir.exists():
        return []

    versions = []
    for version_dir in sorted(versions_dir.iterdir()):
        if not version_dir.is_dir():
            continue

        archived_at = datetime.fromtimestamp(
            version_dir.stat().st_mtime,
            tz=timezone.utc,
        ).strftime("%Y-%m-%d %H:%M")

        files = [item.name for item in version_dir.iterdir() if item.is_file()]
        versions.append({
            "version": version_dir.name,
            "archived_at": archived_at,
            "files": files,
            "path": str(version_dir),
        })

    return versions


def write_json_atomic(path: Path, data: dict) -> None:
    """
    把 JSON 写进去——一次写完。

    它原来直接写目标文件：写到一半断电，或者写错了，目标文件就是半截的
    JSON，下一次读它就炸了。而 `meta.json` 是这个技能的全部家当——脚本、
    元数据、版本号都在里面。

    所以先写到一个旁边的临时文件，再把它换到目标名字上。换名是原子的：
    目标文件要么是旧的完整内容，要么是新的完整内容，不会是半截的。
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    handle = tempfile.NamedTemporaryFile(
        "w",
        encoding="utf-8",
        dir=str(path.parent),
        prefix=f".{path.name}.",
        suffix=".tmp",
        delete=False,
    )
    temp_path = Path(handle.name)
    try:
        with handle:
            handle.write(json.dumps(data, ensure_ascii=False, indent=2))
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_path, path)
    except BaseException:
        temp_path.unlink(missing_ok=True)
        raise


def backup_artifacts(skill_dir: Path, backup_dir: Path) -> None:
    """Copy the current generated artifacts into a backup directory."""
    backup_dir.mkdir(parents=True, exist_ok=True)
    for filename in PRIMARY_ARTIFACTS:
        src = skill_dir / filename
        if src.exists():
            shutil.copy2(src, backup_dir / filename)


def rollback(skill_dir: Path, target_version: str) -> bool:
    """Restore a previously archived version."""
    version_dir = skill_dir / "versions" / target_version
    if not version_dir.exists():
        print(f"error: version does not exist: {target_version}", file=sys.stderr)
        return False

    meta_path = skill_dir / "meta.json"
    if not meta_path.exists():
        print("error: meta.json is required for rollback", file=sys.stderr)
        return False

    meta = enrich_skill_meta(
        json.loads(meta_path.read_text(encoding="utf-8")),
        skill_dir.name,
    )
    current_version = meta.get("version", "v?")
    backup_artifacts(skill_dir, skill_dir / "versions" / f"{current_version}_before_rollback")

    restored_files = []
    for filename in PRIMARY_ARTIFACTS:
        src = version_dir / filename
        if src.exists():
            shutil.copy2(src, skill_dir / filename)
            restored_files.append(filename)

    meta["lifecycle"]["version"] = f"{target_version}_restored"
    meta["lifecycle"]["updated_at"] = now_iso()
    meta["rollback_from"] = current_version
    write_json_atomic(meta_path, sync_legacy_fields(meta))

    print(f"rolled back to {target_version}: {', '.join(restored_files)}")
    return True


def backup_current_version(skill_dir: Path) -> bool:
    """Archive the current generated artifacts under versions/<version>/."""
    meta_path = skill_dir / "meta.json"
    if not meta_path.exists():
        print("error: meta.json is required to determine the current version", file=sys.stderr)
        return False

    meta = enrich_skill_meta(
        json.loads(meta_path.read_text(encoding="utf-8")),
        skill_dir.name,
    )
    current_version = meta.get("version", "v1")
    backup_artifacts(skill_dir, skill_dir / "versions" / current_version)
    print(f"archived version {current_version}")
    return True


def cleanup_old_versions(skill_dir: Path, max_versions: int = MAX_VERSIONS) -> None:
    """Remove archived versions beyond the retention limit."""
    versions_dir = skill_dir / "versions"
    if not versions_dir.exists():
        return

    version_dirs = sorted(
        [entry for entry in versions_dir.iterdir() if entry.is_dir()],
        key=lambda entry: entry.stat().st_mtime,
    )
    to_delete = version_dirs[:-max_versions] if len(version_dirs) > max_versions else []

    for old_dir in to_delete:
        shutil.rmtree(old_dir)
        print(f"deleted old version: {old_dir.name}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Skill version manager")
    parser.add_argument("--action", required=True, choices=["list", "backup", "rollback", "cleanup"])
    parser.add_argument("--slug", required=True, help="Skill slug")
    parser.add_argument("--version", help="Target version for rollback")
    parser.add_argument("--character", default="colleague", help="Character family preset")
    parser.add_argument("--type", help="Deprecated compatibility alias for --character")
    parser.add_argument("--base-dir", help="Skill storage root")

    args = parser.parse_args()
    character = normalize_character(args.character or args.type)
    base_dir = resolve_existing_storage_root(character, slug=args.slug, base_dir_arg=args.base_dir)
    skill_dir = base_dir / args.slug

    if not skill_dir.exists():
        print(f"error: skill directory not found: {skill_dir}", file=sys.stderr)
        sys.exit(1)

    if args.action == "list":
        versions = list_versions(skill_dir)
        if not versions:
            print(f"no archived versions for {args.slug}")
        else:
            print(f"archived versions for {args.slug}:\n")
            for version in versions:
                print(
                    f"  {version['version']}  archived: {version['archived_at']}  "
                    f"files: {', '.join(version['files'])}"
                )
        return

    if args.action == "backup":
        if not backup_current_version(skill_dir):
            # The backup failed — and the script said goodbye with a
            # success. So the caller believed the version was archived
            # when it was not.
            sys.exit(1)
        return

    if args.action == "rollback":
        if not args.version:
            print("error: rollback requires --version", file=sys.stderr)
            sys.exit(1)
        if not rollback(skill_dir, args.version):
            # The rollback failed — and the script said goodbye with a
            # success. So the caller believed the skill was back to the
            # old version when it was not.
            sys.exit(1)
        return

    cleanup_old_versions(skill_dir)
    print("cleanup complete")


if __name__ == "__main__":
    main()
