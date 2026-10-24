#!/usr/bin/env python3
"""
Character preset registry for the dot-skill engine.

The engine itself is a meta-skill. Character presets define which prompt family
and rendering defaults should be used for a given distillation target.
"""

from __future__ import annotations

from pathlib import Path
import json


COMMON_KNOWLEDGE_DIRS = [
    "docs",
    "messages",
    "emails",
]

DEFAULT_RESEARCH_PROFILE = "budget-friendly"

# Every quality threshold the Python gate enforces is declared on the research
# profile presets below. The keys are listed here so a missing threshold is a
# loud error instead of a silently skipped check.
#
# The values themselves live in `prompts/registry.json` — the single source
# of truth that the TypeScript side reads as well — so the gate, the presets
# and the server can never disagree about what "good enough" means.
QUALITY_THRESHOLD_KEYS = (
    "min_raw_notes",
    "min_grounded_urls",
    "min_primary_markers",
    "min_source_metadata_blocks",
    "min_contradiction_bullets",
    "min_inference_bullets",
    "min_track_coverage",
    "max_long_quote_lines",
    "min_skill_grounded_urls",
    "min_mental_models",
    "min_known_answer_questions",
    "min_edge_case_markers",
    "min_weighted_primary_ratio",
    "min_high_tier_sources",
)


REGISTRY_PATH = Path(__file__).resolve().parent.parent / "prompts" / "registry.json"


def load_prompt_registry() -> dict:
    """Reads prompts/registry.json — the single source of truth for prompts."""
    try:
        with open(REGISTRY_PATH, "r", encoding="utf-8") as handle:
            return json.load(handle)
    except (OSError, ValueError):
        return {}


def load_quality_thresholds() -> dict:
    """Reads the quality thresholds of every profile from the registry.

    Returns `{profile: {threshold: value}}` with the values normalised to
    integers. A profile that is missing from the registry is skipped — the
    caller decides whether that is an error.
    """
    section = load_prompt_registry().get("qualityThresholds", {})
    if not isinstance(section, dict):
        return {}

    thresholds: dict = {}
    for profile, values in section.items():
        if not isinstance(values, dict):
            continue
        thresholds[str(profile).strip().lower()] = {
            key: int(values.get(key, 0)) for key in QUALITY_THRESHOLD_KEYS
        }
    return thresholds


def build_prompt_bundle(family: str, profile: str | None = None, include_preset: bool = True) -> dict:
    """
    Builds a prompt bundle from the registry.

    The registry stores paths relative to skill-engine/prompts/; a bundle
    stores them relative to skill-engine/, so "prompts/" is prepended.
    """
    registry = load_prompt_registry()
    entry = registry.get("families", {}).get(family, {})
    stages = dict(entry.get("stages", {}))

    if profile:
        stages.update(entry.get("profiles", {}).get(profile, {}).get("stages", {}))

    bundle = {}
    if include_preset:
        bundle["preset"] = f"dot.{family}.v1"
    for stage, relative in stages.items():
        bundle[stage] = f"prompts/{relative}"
    return bundle


CHARACTER_PRESETS = {
    "colleague": {
        "character": "colleague",
        "display_name": "Colleague",
        "identity_label": "Colleague",
        "gallery_category": "Colleague",
        "source_domain": "work",
        "relationship_to_user": "coworker",
        "is_real_person": True,
        "is_public_figure": False,
        "is_fictional": False,
        "command_aliases": ["/create-colleague", "/create-skill"],
        "knowledge_dirs": COMMON_KNOWLEDGE_DIRS,
        "storage_root": "skills/colleague",
        "prompt_bundle": build_prompt_bundle("colleague"),
        "legacy_storage_root": "colleagues",
        "skill_name_prefix": "colleague",
        "legacy_type": "colleague",
    },
    "relationship": {
        "character": "relationship",
        "display_name": "Relationship",
        "identity_label": "Relationship",
        "gallery_category": "Relationship",
        "source_domain": "personal",
        "relationship_to_user": "relationship",
        "is_real_person": True,
        "is_public_figure": False,
        "is_fictional": False,
        "command_aliases": ["/create-ex", "/create-skill"],
        "knowledge_dirs": COMMON_KNOWLEDGE_DIRS,
        "storage_root": "skills/relationship",
        "prompt_bundle": build_prompt_bundle("relationship"),
        "legacy_storage_root": "skills/relationship",
        "skill_name_prefix": "relationship",
        "legacy_type": "relationship",
    },
    "celebrity": {
        "character": "celebrity",
        "display_name": "Celebrity",
        "identity_label": "Celebrity",
        "gallery_category": "Celebrity",
        "source_domain": "public",
        "relationship_to_user": "public_figure",
        "is_real_person": True,
        "is_public_figure": True,
        "is_fictional": False,
        "command_aliases": ["/create-icon", "/create-skill"],
        "knowledge_dirs": COMMON_KNOWLEDGE_DIRS + [
            "research/raw",
            "research/merged",
            "research/reviews",
            "transcripts",
            "subtitles",
        ],
        "storage_root": "skills/celebrity",
        "prompt_bundle": build_prompt_bundle("celebrity"),
        "default_research_profile": DEFAULT_RESEARCH_PROFILE,
        "research_profiles": {
            "budget-friendly": {
                "name": "budget-friendly",
                "display_name": "Budget Friendly",
                "description": "Lean public-source distillation with compact review and lightweight validation.",
                "prompt_bundle": build_prompt_bundle("celebrity", "budget-friendly", include_preset=False),
                "references": [],
                "merge_strategy": "compact",
                "quality_profile": "budget-friendly",
            },
            "budget-unfriendly": {
                "name": "budget-unfriendly",
                "display_name": "Budget Unfriendly",
                "description": "Deep six-track research with evidence grading, synthesis review, and stricter validation.",
                "prompt_bundle": build_prompt_bundle("celebrity", "budget-unfriendly", include_preset=False),
                "references": [
                    "references/celebrity_budget_unfriendly_framework.md",
                ],
                "merge_strategy": "deep",
                "quality_profile": "budget-unfriendly",
                "required_review_files": [
                    "research_audit.md",
                    "synthesis.md",
                    "validation.md",
                ],
            },
        },
        "research_tools": {
            "subtitle_downloader": "tools/research/download_subtitles.sh",
            "subtitle_cleaner": "tools/research/srt_to_transcript.py",
            "research_merger": "tools/research/merge_research.py",
            "quality_check": "tools/research/quality_check.py",
        },
        "legacy_storage_root": "skills/celebrity",
        "skill_name_prefix": "celebrity",
        "legacy_type": "celebrity",
    },
}


def _apply_registry_thresholds(presets: dict) -> None:
    """Fills the `min_*` thresholds of the presets from the registry.

    The values are declared once, in `prompts/registry.json`; the presets
    expose them so `get_research_profile_preset()` keeps its shape.
    """
    thresholds = load_quality_thresholds()
    if not thresholds:
        return
    for preset in presets.values():
        for profile in preset.get("research_profiles", {}).values():
            key = str(profile.get("quality_profile") or profile.get("name", "")).strip().lower()
            values = thresholds.get(key)
            if values:
                profile.update(values)


_apply_registry_thresholds(CHARACTER_PRESETS)


CHARACTER_ALIASES = {
    "ex": "relationship",
    "self": "relationship",
    "yourself": "relationship",
    "icon": "celebrity",
    "character": "celebrity",
    "fictional-character": "celebrity",
    "nuwa": "celebrity",
}


def normalize_character(character: str | None) -> str:
    """Normalize a character family and fall back to colleague."""
    if not character:
        return "colleague"
    normalized = character.strip().lower()
    normalized = CHARACTER_ALIASES.get(normalized, normalized)
    return normalized if normalized in CHARACTER_PRESETS else "colleague"


def get_character_preset(character: str | None) -> dict:
    """Return the preset for the given character family."""
    return CHARACTER_PRESETS[normalize_character(character)]


def normalize_research_profile(character: str | None, research_profile: str | None) -> str:
    """Normalize a research profile for the selected character family."""
    preset = get_character_preset(character)
    profiles = preset.get("research_profiles", {})
    if not profiles:
        return "standard"
    if not research_profile:
        return preset.get("default_research_profile", DEFAULT_RESEARCH_PROFILE)

    normalized = research_profile.strip().lower().replace("_", "-")
    return (
        normalized
        if normalized in profiles
        else preset.get("default_research_profile", DEFAULT_RESEARCH_PROFILE)
    )


def get_research_profile_preset(character: str | None, research_profile: str | None = None) -> dict:
    """Return the research-profile preset for the given character family."""
    preset = get_character_preset(character)
    profiles = preset.get("research_profiles", {})
    if not profiles:
        return {
            "name": "standard",
            "display_name": "Standard",
            "description": "Default profile for non-celebrity families.",
            "prompt_bundle": {},
            "references": [],
            "merge_strategy": "compact",
            "quality_profile": "budget-friendly",
            "min_raw_notes": 0,
            "min_grounded_urls": 0,
            "min_primary_markers": 0,
            "min_source_metadata_blocks": 0,
            "min_contradiction_bullets": 0,
            "min_inference_bullets": 0,
            "min_track_coverage": 0,
            "max_long_quote_lines": 0,
            "min_skill_grounded_urls": 0,
            "min_mental_models": 0,
            "min_known_answer_questions": 0,
            "min_edge_case_markers": 0,
            "min_weighted_primary_ratio": 0,
            "min_high_tier_sources": 0,
        }
    return profiles[normalize_research_profile(character, research_profile)]


def get_quality_thresholds(quality_profile: str | None) -> dict:
    """Return the quality thresholds declared for a quality profile.

    The values come from `prompts/registry.json` — the single source of truth
    that the TypeScript side reads as well — so `tools/research/quality_check.py`
    and the server can never drift apart. Raises ValueError when the profile
    is unknown — a silent fallback would turn every check into a no-op.
    """
    wanted = (quality_profile or DEFAULT_RESEARCH_PROFILE).strip().lower()
    thresholds = load_quality_thresholds()

    if wanted in thresholds:
        return thresholds[wanted]

    # The registry is keyed by the profile name; fall back to the preset that
    # declares the quality profile.
    for preset in CHARACTER_PRESETS.values():
        for profile in preset.get("research_profiles", {}).values():
            if profile.get("quality_profile") == wanted:
                key = str(profile.get("name", wanted)).strip().lower()
                if key in thresholds:
                    return thresholds[key]

    raise ValueError(f"unknown quality profile: {wanted}")


def normalize_skill_type(skill_type: str | None) -> str:
    """Compatibility shim for older callers that still pass a skill type."""
    return normalize_character(skill_type)


def get_skill_preset(skill_type: str | None) -> dict:
    """Compatibility shim for older callers that still request skill presets."""
    return get_character_preset(skill_type)


def canonical_storage_root(character: str | None) -> Path:
    """Return the canonical storage root for a character family."""
    preset = get_character_preset(character)
    return Path(preset.get("storage_root") or preset["legacy_storage_root"])


def legacy_storage_root(character: str | None) -> Path | None:
    """Return the legacy storage root when it differs from the canonical one."""
    preset = get_character_preset(character)
    legacy = preset.get("legacy_storage_root")
    canonical = str(canonical_storage_root(character))
    if legacy and legacy != canonical:
        return Path(legacy)
    return None


def resolve_storage_root(character: str | None, base_dir_arg: str | None = None) -> Path:
    """Resolve the canonical write target for a character family."""
    if base_dir_arg:
        return Path(base_dir_arg).expanduser()
    return canonical_storage_root(character)


def resolve_existing_storage_root(
    character: str | None,
    slug: str | None = None,
    base_dir_arg: str | None = None,
) -> Path:
    """Resolve an existing storage root while keeping legacy paths readable."""
    if base_dir_arg:
        return Path(base_dir_arg).expanduser()

    canonical = canonical_storage_root(character)
    legacy = legacy_storage_root(character)

    if slug:
        if (canonical / slug).exists():
            return canonical
        if legacy and (legacy / slug).exists():
            return legacy

    if canonical.exists():
        return canonical
    if legacy and legacy.exists():
        return legacy
    return canonical
