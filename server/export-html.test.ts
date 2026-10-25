import { describe, expect, it } from "vitest";
import { generateChatExportHTML } from "./_core/export-html";

/**
 * The keepsake.
 *
 * The HTML export was hardcoded Chinese whatever the interface was, so
 * an English-speaking user downloaded a keepsake they could not read.
 * The headings were swapped for a lookup table while the strings they
 * replaced stayed where they were — the table existed and nothing used
 * it. A test is the only thing that catches that.
 */
const params = {
  persona: {
    name: "小A",
    relationshipDesc: "ex-girlfriend",
    createdAt: new Date("2024-01-01T00:00:00Z"),
    farewellLetter: "Thank you for everything.",
    graduatedAt: new Date("2024-02-01T00:00:00Z"),
  },
  messages: [
    {
      role: "user",
      content: "在吗",
      emotionalState: null,
      messageType: "text",
      createdAt: new Date("2024-01-01T10:00:00Z"),
    },
    {
      role: "assistant",
      content: "在的。",
      emotionalState: "warm",
      messageType: "text",
      createdAt: new Date("2024-01-01T10:00:05Z"),
    },
  ],
  memories: [
    {
      title: "第一次见面",
      description: "在图书馆门口",
      category: "milestone",
      date: "2019-05-20",
      createdAt: new Date("2019-05-20T00:00:00Z"),
    },
  ],
  emotionSnapshots: [
    { emotionalState: "warm", messageCount: 3, date: "2024-01-01", createdAt: new Date("2024-01-01T00:00:00Z") },
  ],
  diaryEntries: [
    { date: "2024-01-01", summary: "今天聊了聊。", reflection: "有点想她。" },
  ],
  letters: [
    {
      body: "有件事我一直没说。",
      kind: "letter",
      status: "answered",
      replyText: "我知道。",
      repliedAt: new Date("2024-02-02T00:00:00Z"),
      createdAt: new Date("2024-02-01T00:00:00Z"),
    },
  ],
  intimacy: { score: 720, level: "intimate" },
};

describe("the HTML export", () => {
  it("follows the language it is asked for", () => {
    const zh = generateChatExportHTML(params, "zh");
    const en = generateChatExportHTML(params, "en");

    expect(zh).toContain("<h2>记忆里程碑</h2>");
    expect(en).toContain("<h2>Milestones</h2>");
    expect(en).toContain("<h2>Diaries</h2>");
    expect(en).toContain("<h2>Letters</h2>");
    expect(en).toContain("<h2>The farewell letter</h2>");
  });

  it("does not leave Chinese in the English export", () => {
    const en = generateChatExportHTML(params, "en");
    const han = /[一-鿿]/g;
    const found = en.match(han);
    // The content itself is Chinese — that is the user's own writing. What
    // must not be there is the app's own wording.
    const withoutContent = en
      // The persona's name is the user's own content, not the app's.
      .replace(/小A/g, "")
      .replace(/<p class="mem-title">[^<]*<\/p>/g, "")
      .replace(/<p class="mem-desc">[^<]*<\/p>/g, "")
      .replace(/<p>[^<]*<\/p>/g, "")
      .replace(/<p class="reflection">[^<]*<\/p>/g, "")
      .replace(/<div class="bubble [^"]*">[^<]*<\/div>/g, "");
    expect(withoutContent.match(han)).toBeNull();
  });

  it("says which language it is in", () => {
    expect(generateChatExportHTML(params, "en")).toContain('<html lang="en">');
    expect(generateChatExportHTML(params, "zh")).toContain('<html lang="zh-CN">');
  });

  it("carries the letters, which are the artefact worth keeping", () => {
    const html = generateChatExportHTML(params, "zh");
    expect(html).toContain("有件事我一直没说。");
    expect(html).toContain("我知道。");
  });

  it("names the intimacy level in words, not in a key", () => {
    expect(generateChatExportHTML(params, "zh")).toContain("亲密");
    expect(generateChatExportHTML(params, "en")).toContain("Intimate");
  });
});
