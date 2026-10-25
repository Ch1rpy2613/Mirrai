import { describe, expect, it } from "vitest";
import {
  BUILTIN_SCENE_DEFINITIONS,
  BUILTIN_SCENE_SLUGS,
} from "./scenes";
import { localizeScene, copy } from "./index";

/**
 * The scenes that come with the app.
 *
 * A scene the app ships should read in the language the person is reading.
 * The row in the database keeps its Chinese name — that name is how the
 * scene is recognised, and it is what every existing installation already
 * has — but the wording a person reads is swapped in.
 *
 * The definitions are also the seed. There used to be two copies of the
 * same Chinese sentences: one in the copy table and one in the seeding
 * routine, and they could drift apart.
 */
describe("the built-in scenes", () => {
  it("every scene has both languages", () => {
    for (const scene of BUILTIN_SCENE_DEFINITIONS) {
      expect(scene.name, scene.slug).toBeTruthy();
      expect(scene.nameEn, scene.slug).toBeTruthy();
      expect(scene.description.zh, scene.slug).toBeTruthy();
      expect(scene.description.en, scene.slug).toBeTruthy();
      expect(scene.overlay.zh, scene.slug).toBeTruthy();
      expect(scene.overlay.en, scene.slug).toBeTruthy();
      expect(scene.starters.length, scene.slug).toBeGreaterThan(0);
      for (const starter of scene.starters) {
        expect(starter.zh, scene.slug).toBeTruthy();
        expect(starter.en, scene.slug).toBeTruthy();
      }
    }
  });

  it("says something different in the two languages", () => {
    // A half-finished translation would leave the English identical to the
    // Chinese.
    for (const scene of BUILTIN_SCENE_DEFINITIONS) {
      expect(scene.nameEn, scene.slug).not.toBe(scene.name);
      expect(scene.description.en, scene.slug).not.toBe(scene.description.zh);
      expect(scene.overlay.en, scene.slug).not.toBe(scene.overlay.zh);
      for (const starter of scene.starters) {
        expect(starter.en, scene.slug).not.toBe(starter.zh);
      }
    }
  });

  it("knows its own scenes by the name the row carries", () => {
    for (const scene of BUILTIN_SCENE_DEFINITIONS) {
      expect(BUILTIN_SCENE_SLUGS[scene.name], scene.slug).toBe(scene.slug);
    }
  });

  it("has a copy entry for every part of every scene", () => {
    for (const scene of BUILTIN_SCENE_DEFINITIONS) {
      expect(copy("zh", `scenes.${scene.slug}.name`)).toBe(scene.name);
      expect(copy("en", `scenes.${scene.slug}.name`)).toBe(scene.nameEn);
      expect(copy("en", `scenes.${scene.slug}.description`)).toBe(scene.description.en);
      expect(copy("en", `scenes.${scene.slug}.overlay`)).toBe(scene.overlay.en);
      scene.starters.forEach((starter, index) => {
        expect(copy("en", `scenes.${scene.slug}.starter${index + 1}`)).toBe(starter.en);
      });
    }
  });
});

describe("reading a scene in the language of the reader", () => {
  /** The row the database holds for a built-in scene. */
  function row(slug: string) {
    const scene = BUILTIN_SCENE_DEFINITIONS.find((s) => s.slug === slug)!;
    return {
      name: scene.name,
      icon: scene.icon,
      description: scene.description.zh,
      systemPromptOverlay: scene.overlay.zh,
      emotionalState: scene.emotionalState,
      starters: scene.starters.map((s) => s.zh),
      isBuiltin: true,
    };
  }

  it("swaps the wording for the English reader", () => {
    const localised = localizeScene(row("cinema"), "en");

    expect(localised.name).toBe("Watching a film together");
    expect(localised.description).toBe(
      "On the sofa watching a film, and talking about how it lands",
    );
    expect(localised.systemPromptOverlay).toContain("You are watching a film together");
    expect(localised.starters?.[0]).toBe("What kind of film do you want to watch today?");
  });

  it("leaves the Chinese reader's wording exactly as it was", () => {
    const original = row("cinema");
    const localised = localizeScene(original, "zh");

    expect(localised.name).toBe(original.name);
    expect(localised.description).toBe(original.description);
    expect(localised.systemPromptOverlay).toBe(original.systemPromptOverlay);
    expect(localised.starters).toEqual(original.starters);
  });

  it("leaves a scene of the user's own alone", () => {
    // Somebody who wrote their own scene wrote it in their own words.
    const own = {
      name: "在厨房里忙活",
      description: "做饭",
      systemPromptOverlay: "你们在厨房里一起做饭。",
      starters: ["今天做什么？"],
      isBuiltin: false,
    };
    expect(localizeScene(own, "en")).toEqual(own);
  });

  it("keeps a scene whose opening lines were edited", () => {
    // The row has been edited — it no longer has the three lines the copy
    // table has — so the wording is left alone rather than putting
    // somebody else's line in its place.
    const edited = { ...row("cinema"), starters: ["今天想看什么？"] };
    const localised = localizeScene(edited, "en");

    expect(localised.starters).toEqual(["今天想看什么？"]);
  });
});
