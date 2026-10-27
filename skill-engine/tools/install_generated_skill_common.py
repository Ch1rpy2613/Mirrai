#!/usr/bin/env python3
"""Shared helpers for installing generated dot-skill artifacts into host skill roots."""

from __future__ import annotations

import json
import os
import re
import shutil
import tempfile
from pathlib import Path
from typing import Callable

from skill_schema import enrich_skill_meta, now_iso


FRONTMATTER_RE = re.compile(r"\A---\n(.*?)\n---\n?", re.DOTALL)


def replace_directory(target: Path, populate: Callable[[Path], None]) -> None:
    """把 `target` 换成一个新目录，失败时旧目录还在。

    原来的写法是先 `shutil.rmtree(target)` 再写新的。写的那一步要是
    失败了（磁盘满了、权限不对、进程被杀掉），旧的那份已经被删掉了，
    而新的那份从来没有写出来——用户手里的技能就这么没了，什么都没留下。

    现在是：先在旁边写好一个新的，再换上去。换的那一下坏了，就把旧的
    换回来。
    """
    target.parent.mkdir(parents=True, exist_ok=True)

    staging = Path(tempfile.mkdtemp(prefix=f".{target.name}.new-", dir=str(target.parent)))
    backup: Path | None = None
    try:
        populate(staging)

        if target.exists():
            backup = target.parent / f".{target.name}.old-{os.getpid()}"
            if backup.exists():
                shutil.rmtree(backup)
            target.rename(backup)

        try:
            staging.rename(target)
        except Exception:
            # 换不上去——把旧的换回来。
            if backup is not None and backup.exists() and not target.exists():
                backup.rename(target)
            raise

        if backup is not None and backup.exists():
            shutil.rmtree(backup, ignore_errors=True)
    finally:
        if staging.exists():
            shutil.rmtree(staging, ignore_errors=True)


def load_generated_meta(skill_dir: Path) -> dict:
    """Load and normalize generated skill metadata from a skill directory."""
    meta_path = skill_dir / "meta.json"
    if not meta_path.exists():
        raise FileNotFoundError(f"generated skill is missing meta.json: {skill_dir}")
    return enrich_skill_meta(
        json.loads(meta_path.read_text(encoding="utf-8")),
        skill_dir.name,
    )


def rewrite_frontmatter_name(markdown: str, new_name: str) -> str:
    """Rewrite the frontmatter name field to the installed command name."""
    match = FRONTMATTER_RE.match(markdown)
    if not match:
        return markdown

    body = markdown[match.end():]
    lines = match.group(1).splitlines()
    rewritten: list[str] = []
    replaced = False

    for line in lines:
        if line.startswith("name:"):
            rewritten.append(f"name: {new_name}")
            replaced = True
        else:
            rewritten.append(line)

    if not replaced:
        rewritten.insert(0, f"name: {new_name}")

    return f"---\n" + "\n".join(rewritten) + "\n---\n\n" + body.lstrip("\n")


def render_installed_markdown(skill_dir: Path, artifact_name: str, command_name: str) -> str:
    """Load a generated artifact and rewrite it for host installation."""
    artifact_path = skill_dir / artifact_name
    if not artifact_path.exists():
        raise FileNotFoundError(f"generated artifact not found: {artifact_path}")
    return rewrite_frontmatter_name(
        artifact_path.read_text(encoding="utf-8"),
        command_name,
    )


def write_install_metadata(install_dir: Path, payload: dict) -> None:
    """Persist installation metadata for later debugging and upgrades."""
    (install_dir / ".dot-skill-install.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def install_generated_skill(
    skill_dir: Path,
    skills_dir: Path,
    *,
    force: bool = False,
    dry_run: bool = False,
    host: str,
) -> dict:
    """Install a generated combined skill into a host skill directory."""
    meta = load_generated_meta(skill_dir)
    artifacts = meta["artifacts"]
    command_name = artifacts["combined_command"]
    installed_markdown = render_installed_markdown(
        skill_dir,
        artifacts["combined_skill"],
        command_name,
    )

    install_dir = skills_dir / command_name
    install_file = install_dir / "SKILL.md"

    install_record = {
        "host": host,
        "command_name": command_name,
        "character": meta["character"],
        "slug": meta["slug"],
        "version": meta["version"],
        "source_skill_dir": str(skill_dir),
        "source_artifact": artifacts["combined_skill"],
        "installed_at": now_iso(),
    }

    if not dry_run:
        if install_dir.exists() and not force:
            raise FileExistsError(f"{host} skill already exists: {install_dir}")

        def populate(staging: Path) -> None:
            (staging / "SKILL.md").write_text(installed_markdown, encoding="utf-8")
            write_install_metadata(staging, install_record)

        replace_directory(install_dir, populate)

    return {
        "host": host,
        "command_name": command_name,
        "skill_dir": install_dir,
        "skill_file": install_file,
    }
