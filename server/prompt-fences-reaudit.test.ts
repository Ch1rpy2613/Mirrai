import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Every place the user's own words reach a model is fenced.
 *
 * The user's own conversation is text the user wrote — or text the
 * persona said in answer to something the user wrote. It is not an
 * instruction to the model, and it says nothing about what the model
 * should do. But the model reads everything in its prompt as
 * instructions.
 *
 * The fences went in one commit at a time, and each time only the
 * place that commit was about. So the emotion classifier, the history
 * summary and the diary writer were all still open.
 */

const ROOT = path.resolve(__dirname, "..");

function read(relative: string): string {
  return readFileSync(path.join(ROOT, relative), "utf-8");
}

/** The places where the user's own text goes to a model. */
const SITES: Array<{ file: string; what: string; pattern: RegExp }> = [
  {
    file: "server/_core/emotion.ts",
    what: "the emotion classifier",
    pattern: /asMaterial\(\s*copy\(locale, "prompts\.emotionStateTemplate"/,
  },
  {
    file: "server/chat/service.ts",
    what: "the history summary",
    pattern: /content: asMaterial\(transcript, locale\)/,
  },
  {
    file: "server/routers.ts",
    what: "the diary writer",
    pattern: /content: asMaterial\(diaryText, ctx\.locale\)/,
  },
  {
    file: "server/chat/outbound.ts",
    what: "the outbound candidates",
    pattern: /content: asMaterial\(transcript, params\.locale\)/,
  },
  {
    file: "server/safety/trajectory.ts",
    what: "the trajectory assessment",
    pattern: /asMaterial\(/,
  },
  {
    file: "server/chat/memory-extract.ts",
    what: "the memory extraction",
    pattern: /asMaterial\(/,
  },
  {
    file: "server/chat/farewell-candidates.ts",
    what: "the farewell candidates",
    pattern: /asMaterial\(/,
  },
];

describe("the places the user's own words reach a model", () => {
  for (const site of SITES) {
    it(`${site.what} fences what it sends`, () => {
      expect(read(site.file), site.file).toMatch(site.pattern);
    });
  }
});

describe("the classifier's prompt", () => {
  it("does not interpolate the user's message raw", () => {
    const source = read("server/_core/emotion.ts");
    // The message goes through the fence, and what reaches the model is
    // the fenced block — not the template with the text in it.
    expect(source).not.toMatch(
      /content: copy\(locale, "prompts\.emotionStateTemplate"/,
    );
  });
});

describe("the history summary's prompt", () => {
  it("does not send the transcript raw", () => {
    const source = read("server/chat/service.ts");
    expect(source).not.toMatch(/\{ role: "user", content: transcript \}/);
  });
});

describe("the diary writer's prompt", () => {
  it("does not send the day raw", () => {
    const source = read("server/routers.ts");
    expect(source).not.toMatch(/\{ role: "user" as const, content: diaryText \}/);
  });
});
