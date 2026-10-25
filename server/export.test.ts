import { describe, expect, it } from "vitest";
import { exportAsJson, exportAsMarkdown, type ExportBundle } from "./_core/export-data";

/**
 * The user's data, in a form they can keep.
 *
 * The export used to be a single HTML page with the messages on it. "My
 * data" means the memories, the diaries, the farewell letter, the
 * relationship events and the user's own moods too — and a format that
 * does not need this app.
 */
function bundle(): ExportBundle {
  return {
    user: {
      username: "someone",
      name: "小张",
      email: "me@example.com",
      timezone: "Asia/Shanghai",
      addressStyle: "老张",
      boundaries: "别提我前任",
      createdAt: new Date("2025-01-01T00:00:00Z"),
    },
    personas: [
      {
        id: 1,
        name: "小A",
        relationshipDesc: "前女友",
        togetherFrom: "2021-06-15",
        togetherTo: "2024-01-01",
        emotionalState: "warm",
        personaData: { personality: "温柔" },
        graduationStatus: "graduated",
        graduatedAt: new Date("2024-02-01T00:00:00Z"),
        farewellLetter: "亲爱的，感谢你一路的陪伴。",
        presence: "asleep",
        timezone: "Europe/London",
        intimacy: { score: 720, level: "close" },
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
            title: "第一次一起看海",
            description: "在青岛",
            category: "milestone",
            date: "2021-07-01",
            createdAt: new Date("2021-07-01T00:00:00Z"),
          },
        ],
        diaries: [
          { date: "2024-01-01", summary: "今天没聊几句", reflection: "有点堵" },
        ],
        snapshots: [
          { emotionalState: "warm", messageCount: 1, date: "2024-01-01" },
        ],
        events: [
          {
            kind: "breakup",
            title: "我们分手了",
            detail: "在一个很普通的晚上",
            happenedAt: new Date("2024-01-01T00:00:00Z"),
          },
        ],
        letters: [
          {
            body: "有件事我一直没有说。",
            kind: "letter",
            mood: "down",
            status: "answered",
            replyText: "我知道。",
            repliedAt: new Date("2024-02-02T00:00:00Z"),
            createdAt: new Date("2024-02-01T00:00:00Z"),
          },
        ],
      },
    ],
    moods: [
      { date: "2024-01-01", mood: "down", note: "说不出来" },
      { date: "2024-01-02", mood: "okay", note: null },
    ],
  };
}

describe("the export", () => {
  it("carries the letters in the bundle", () => {
    const b = bundle();
    expect(b.personas[0].letters).toHaveLength(1);
    expect(b.personas[0].letters[0].replyText).toBe("我知道。");
  });

  it("carries everything, not just the messages", () => {
    const parsed = JSON.parse(exportAsJson(bundle()));
    expect(parsed.user.username).toBe("someone");
    expect(parsed.personas[0].farewellLetter).toContain("感谢你");
    expect(parsed.personas[0].memories).toHaveLength(1);
    expect(parsed.personas[0].diaries).toHaveLength(1);
    expect(parsed.personas[0].events[0].kind).toBe("breakup");
    expect(parsed.moods).toHaveLength(2);
  });

  it("writes the farewell letter into the Markdown", () => {
    const markdown = exportAsMarkdown(bundle());
    expect(markdown).toContain("# 小A");
    expect(markdown).toContain("## 告别信");
    expect(markdown).toContain("感谢你一路的陪伴");
  });

  it("writes the relationship events into the Markdown", () => {
    const markdown = exportAsMarkdown(bundle());
    expect(markdown).toContain("## 你们之间发生的事");
    expect(markdown).toContain("我们分手了");
    expect(markdown).toContain("在一个很普通的晚上");
  });

  it("writes the memories and the diaries into the Markdown", () => {
    const markdown = exportAsMarkdown(bundle());
    expect(markdown).toContain("## 记忆");
    expect(markdown).toContain("第一次一起看海");
    expect(markdown).toContain("## 对话日记");
    expect(markdown).toContain("有点堵");
  });

  it("writes the letters into the Markdown", () => {
    // The letters are the artefact somebody would most want to keep:
    // what was written at two in the morning, and the reply that came
    // a day later. The export used to leave them out.
    const markdown = exportAsMarkdown(bundle());
    expect(markdown).toContain("## 信");
    expect(markdown).toContain("有件事我一直没有说。");
    expect(markdown).toContain("我知道。");
  });

  it("writes the user's own moods into the Markdown", () => {
    const markdown = exportAsMarkdown(bundle());
    expect(markdown).toContain("## 我的状态");
    expect(markdown).toContain("说不出来");
  });

  it("writes the conversation with who said it", () => {
    const markdown = exportAsMarkdown(bundle());
    expect(markdown).toContain("**我**");
    expect(markdown).toContain("**小A**");
    expect(markdown).toContain("在的。");
  });

  it("keeps the end date in the relationship line", () => {
    const markdown = exportAsMarkdown(bundle());
    expect(markdown).toContain("2021-06-15");
    expect(markdown).toContain("2024-01-01");
  });
});
