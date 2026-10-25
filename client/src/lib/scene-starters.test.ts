import { describe, expect, it } from "vitest";
import { resolveStarterQuestions } from "./scene-starters";

/**
 * The opening lines of a conversation.
 *
 * A scene knows what is happening right now, the persona knows how this
 * person usually starts a conversation, and the app has a generic set for
 * when neither knows. The scene is the most specific answer, so it wins.
 */
describe("the opening lines of a conversation", () => {
  const fallback = ["今天过得怎么样？", "在忙什么呀？"];

  it("uses the scene's own lines when the scene has them", () => {
    const starters = resolveStarterQuestions({
      sceneStarters: ["今天想看什么类型的电影？"],
      personaStarters: ["你吃饭了吗"],
      fallback,
    });
    expect(starters).toEqual(["今天想看什么类型的电影？"]);
  });

  it("falls back to the persona's lines", () => {
    const starters = resolveStarterQuestions({
      sceneStarters: [],
      personaStarters: ["你吃饭了吗"],
      fallback,
    });
    expect(starters).toEqual(["你吃饭了吗"]);
  });

  it("falls back to the app's lines when neither knows", () => {
    const starters = resolveStarterQuestions({
      sceneStarters: [],
      personaStarters: [],
      fallback,
    });
    expect(starters).toEqual(fallback);
  });

  it("ignores empty and malformed values", () => {
    const starters = resolveStarterQuestions({
      sceneStarters: ["", "   "],
      personaStarters: null,
      fallback,
    });
    expect(starters).toEqual(fallback);

    const malformed = resolveStarterQuestions({
      sceneStarters: "不是数组",
      personaStarters: [1, 2, 3],
      fallback,
    });
    expect(malformed).toEqual(fallback);
  });

  it("does not hand back the fallback array itself", () => {
    const starters = resolveStarterQuestions({ fallback });
    expect(starters).not.toBe(fallback);
    expect(starters).toEqual(fallback);
  });
});
