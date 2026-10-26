import { spawnSync } from "child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { ENV } from "../_core/env";
import {
  normaliseCollectorOutput,
  parseNormalisedPayload,
  parseProgressLine,
  stripProgressLines,
} from "./runner";
import {
  configureCollectors,
  enqueueCollectorJob,
  getCollectorJob,
  listCollectorJobs,
  onJobUpdate,
  reconcileInterruptedJobs,
  resetCollectors,
  waitForCollectorJob,
} from "./jobs";
import { COLLECTOR_SOURCES } from "./types";
import type {
  CollectInput,
  CollectorAuthState,
  CollectorSourceId,
  SourceConnector,
} from "./types";

/** Builds a connector that never touches Python or the network. */
function fakeConnector(
  id: CollectorSourceId,
  collect: (input: CollectInput) => Promise<{ messages: Array<{ role: "user" | "assistant"; content: string }> }>,
): SourceConnector {
  return {
    id,
    label: `fake:${id}`,
    requiresBrowser: false,
    tool: "fake_collector.py",
    args: () => [],
    checkAuth: async (): Promise<CollectorAuthState> => ({ ok: true }),
    collect: async (input: CollectInput) => {
      const { messages } = await collect(input);
      return {
        messages: messages.map((message) => ({ ...message, source: id })),
        meta: { total: messages.length, source: id },
      };
    },
  };
}

/** Polls until the predicate holds (or the test times out). */
async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("Timed out waiting for condition");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

afterEach(() => {
  resetCollectors();
});

describe("normaliseCollectorOutput", () => {
  it("parses a JSON array of messages", () => {
    const raw = JSON.stringify([
      { sender: "张三", content: "在吗", timestamp: "2024-01-01 10:00" },
      { sender: "我", content: "在的", timestamp: "2024-01-01 10:01" },
    ]);

    const result = normaliseCollectorOutput(raw, "feishu", { target: "张三" });

    expect(result.messages).toHaveLength(2);
    expect(result.messages[0]).toMatchObject({
      role: "assistant",
      content: "在吗",
      source: "feishu",
    });
    expect(result.messages[1]).toMatchObject({ role: "user", content: "在的" });
    expect(result.messages[0].timestamp).toBe(new Date("2024-01-01 10:00").toISOString());
    expect(result.meta).toEqual({ total: 2, source: "feishu", truncated: false });
  });

  it("parses a JSON object with a messages array", () => {
    const raw = JSON.stringify({
      messages: [
        { role: "user", content: "hi" },
        { role: "assistant", content: "hello" },
      ],
    });

    const result = normaliseCollectorOutput(raw, "slack");

    expect(result.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(result.messages[1].content).toBe("hello");
    expect(result.meta.source).toBe("slack");
    expect(result.meta.total).toBe(2);
  });

  it("parses JSONL (one message object per line)", () => {
    const raw = [
      '{"role":"user","content":"在吗"}',
      '{"role":"assistant","content":"在"}',
    ].join("\n");

    const result = normaliseCollectorOutput(raw, "email");

    expect(result.messages).toHaveLength(2);
    expect(result.messages[0]).toMatchObject({ role: "user", content: "在吗" });
    expect(result.messages[1]).toMatchObject({ role: "assistant", content: "在" });
  });

  it("parses a plain-text transcript with role markers", () => {
    const raw = ["用户: 你好呀", "TA: 在呢，一起吃饭吗"].join("\n");

    const result = normaliseCollectorOutput(raw, "wechat_export");

    expect(result.messages).toHaveLength(2);
    expect(result.messages[0]).toMatchObject({ role: "user", content: "你好呀" });
    expect(result.messages[1]).toMatchObject({ role: "assistant", content: "在呢，一起吃饭吗" });
  });

  it("skips malformed lines instead of throwing", () => {
    const raw = [
      '{"role":"user","content":"第一条"}',
      "{ this is not json",
      '{"role":"assistant","content":"第二条"}',
    ].join("\n");

    const result = normaliseCollectorOutput(raw, "dingtalk");

    expect(result.messages).toHaveLength(2);
    expect(result.messages[1].content).toBe("第二条");
  });

  it("throws a clear error naming the source when nothing can be parsed", () => {
    expect(() => normaliseCollectorOutput("这不是任何已知格式", "dingtalk")).toThrow(/dingtalk/);
    expect(() => normaliseCollectorOutput("", "slack")).toThrow(/slack/);
  });

  it("marks the result as truncated when the limit is reached", () => {
    const raw = JSON.stringify([
      { role: "user", content: "1" },
      { role: "assistant", content: "2" },
      { role: "user", content: "3" },
    ]);

    const result = normaliseCollectorOutput(raw, "feishu", { limit: 2 });

    expect(result.messages).toHaveLength(2);
    expect(result.meta.truncated).toBe(true);
  });

  it("parses the message report the Feishu collector writes", () => {
    // Mirrors `collect_messages()` in skill-engine/tools/feishu_auto_collector.py.
    const raw = [
      "# 飞书消息记录（自动采集）",
      "目标：张三",
      "共 3 条消息（目标用户 2 条，对话方 1 条）",
      "",
      "---",
      "",
      "## 长消息（观点/决策/技术类）",
      "",
      "[2024-01-01 10:00][项目群] 这是一条很长的消息，用于测试长消息段落。",
      "",
      "---",
      "",
      "## 日常消息（风格参考）",
      "",
      "[2024-01-01 11:00] 好的",
      "",
      "---",
      "",
      "## 私聊对话上下文（含双方消息）",
      "",
      "[2024-01-01 12:00] [张三] 我到家了",
      "[2024-01-01 12:01] [对方] 好的，注意安全",
    ].join("\n");

    const result = normaliseCollectorOutput(raw, "feishu", { target: "张三" });

    expect(result.messages).toHaveLength(4);
    expect(result.messages[0]).toMatchObject({ role: "assistant", content: "这是一条很长的消息，用于测试长消息段落。" });
    expect(result.messages[1]).toMatchObject({ role: "assistant", content: "好的" });
    // Only the private-chat section mixes both sides of the conversation.
    expect(result.messages[2]).toMatchObject({ role: "assistant", content: "我到家了" });
    expect(result.messages[3]).toMatchObject({ role: "user", content: "好的，注意安全" });
    expect(result.messages[3].timestamp).toBe(new Date("2024-01-01 12:01").toISOString());
  });

  it("parses the report the e-mail collector writes", () => {
    // Mirrors `format_output()` in skill-engine/tools/email_parser.py.
    const raw = [
      "# 邮件提取结果",
      "目标人物：zhangsan@company.com",
      "总邮件数：2",
      "",
      "---",
      "",
      "## 长邮件（技术方案/观点类，权重最高）",
      "",
      "**主题：方案评审** [Mon, 01 Jan 2024 10:00:00 +0800]",
      "这是正文内容。",
      "第二行。",
      "",
      "---",
      "",
      "## 日常沟通（风格参考）",
      "",
      "**午饭？**：好啊",
    ].join("\n");

    const result = normaliseCollectorOutput(raw, "email", { target: "zhangsan@company.com" });

    expect(result.messages).toHaveLength(2);
    expect(result.messages[0].content).toContain("方案评审");
    expect(result.messages[0].content).toContain("这是正文内容。");
    expect(result.messages[0].role).toBe("assistant");
    expect(result.messages[1].content).toContain("午饭？");
    expect(result.messages[0].timestamp).toBe(new Date("2024-01-01T02:00:00.000Z").toISOString());
  });

  it("keeps the Markdown chrome out of the e-mail body", () => {
    // The separator and the heading of the next section belong to the report,
    // not to the mail that was read before them.
    const raw = [
      "# 邮件提取结果",
      "",
      "---",
      "",
      "## 长邮件（技术方案/观点类，权重最高）",
      "",
      "**主题：方案评审** [Mon, 01 Jan 2024 10:00:00 +0800]",
      "这是正文内容。",
      "",
      "---",
      "",
      "## 日常沟通（风格参考）",
      "",
      "**午饭？**：好啊",
    ].join("\n");

    const result = normaliseCollectorOutput(raw, "email", { target: "zhangsan@company.com" });

    expect(result.messages).toHaveLength(2);
    expect(result.messages[0].content).toBe("主题：方案评审\n这是正文内容。");
    expect(result.messages[0].content).not.toContain("---");
    expect(result.messages[0].content).not.toContain("## ");
    expect(result.messages[1].content).toBe("午饭？\n好啊");
  });
});

describe("parseProgressLine", () => {
  it("turns a 0..1 fraction into a 0..100 integer", () => {
    expect(parseProgressLine("[PROGRESS] 0.42")).toBe(42);
    expect(parseProgressLine("  [PROGRESS] 0  ")).toBe(0);
    expect(parseProgressLine("[PROGRESS] 1")).toBe(100);
  });

  it("ignores lines that are not progress reports", () => {
    expect(parseProgressLine("采集完成")).toBeNull();
    expect(parseProgressLine("[PROGRESS] abc")).toBeNull();
    expect(parseProgressLine("progress: 0.5")).toBeNull();
  });
});

describe("the normalised collector payload", () => {
  /** The shape the Python collectors print with `--format json`. */
  const payload = {
    messages: [
      {
        role: "user",
        content: "在吗",
        timestamp: "2024-01-01T10:00:00.000Z",
        source: "feishu",
      },
      {
        role: "assistant",
        content: "在的",
        timestamp: "2024-01-01T10:01:00.000Z",
        source: "feishu",
      },
    ],
    meta: { total: 2, source: "feishu", truncated: false },
  };

  it("is the primary path: the normalised JSON is parsed as-is", () => {
    const result = normaliseCollectorOutput(JSON.stringify(payload), "feishu");

    expect(result.messages).toHaveLength(2);
    expect(result.messages[0]).toEqual({
      role: "user",
      content: "在吗",
      timestamp: "2024-01-01T10:00:00.000Z",
      source: "feishu",
    });
    expect(result.messages[1].role).toBe("assistant");
    expect(result.meta).toEqual({ total: 2, source: "feishu", truncated: false });
  });

  it("keeps the payload's truncation flag", () => {
    const result = normaliseCollectorOutput(
      JSON.stringify({ ...payload, meta: { total: 2, source: "feishu", truncated: true } }),
      "feishu",
    );

    expect(result.meta.truncated).toBe(true);
  });

  it("treats an empty normalised payload as an empty result", () => {
    // A collector that found nothing has said so — that is not a parse error.
    const result = normaliseCollectorOutput(
      JSON.stringify({ messages: [], meta: { total: 0, source: "feishu", truncated: false } }),
      "feishu",
    );

    expect(result.messages).toEqual([]);
    expect(result.meta.total).toBe(0);
  });

  it("applies the limit to the normalised payload", () => {
    const result = normaliseCollectorOutput(JSON.stringify(payload), "feishu", { limit: 1 });

    expect(result.messages).toHaveLength(1);
    // The total is how many were *found* — so a collection that was
    // cut short can say so. It used to be the length of the kept list,
    // which said the opposite.
    expect(result.meta.total).toBe(payload.messages.length);
    expect(result.meta.truncated).toBe(true);
  });

  it("returns undefined when the output is not a normalised payload", () => {
    expect(parseNormalisedPayload("这不是 JSON", "feishu")).toBeUndefined();
    expect(parseNormalisedPayload(JSON.stringify([{ content: "hi" }]), "feishu")).toBeUndefined();
    expect(parseNormalisedPayload(JSON.stringify({ items: [] }), "feishu")).toBeUndefined();
  });

  it("still falls back to the legacy parsers when the collector prints no JSON", () => {
    const legacy = [
      "# 飞书消息记录（自动采集）",
      "## 日常消息（风格参考）",
      "[2024-01-01 10:00] 好的",
    ].join("\n");

    const result = normaliseCollectorOutput(legacy, "feishu");

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].content).toBe("好的");
  });

  it("survives progress lines mixed into the payload", () => {
    const mixed = ["[PROGRESS] 0.42", JSON.stringify(payload), "[PROGRESS] 1.00"].join("\n");

    const result = normaliseCollectorOutput(mixed, "feishu");

    expect(result.messages).toHaveLength(2);
    expect(result.messages[0].content).toBe("在吗");
  });
});

describe("stripProgressLines", () => {
  it("removes the progress lines and keeps everything else", () => {
    const text = ["[PROGRESS] 0.10", "hello", "[PROGRESS] 0.90"].join("\n");

    expect(stripProgressLines(text).trim()).toBe("hello");
  });

  it("leaves output without progress lines untouched", () => {
    expect(stripProgressLines("hello\nworld")).toBe("hello\nworld");
    expect(stripProgressLines("")).toBe("");
  });
});

describe("the collector argv", () => {
  const connector = (id: CollectorSourceId): SourceConnector => {
    const found = COLLECTOR_SOURCES.find((source) => source.id === id);
    if (!found) throw new Error(`missing connector ${id}`);
    return found;
  };

  it("asks the collectors for the normalised JSON exit", () => {
    for (const id of ["feishu", "dingtalk", "slack", "email"] as CollectorSourceId[]) {
      const argv = connector(id).args({ target: "张三" });
      expect(argv, `${id} must request the JSON exit`).toContain("--format");
      expect(argv, `${id} must request the JSON exit`).toContain("json");
    }
  });

  it("keeps the other arguments of the collector", () => {
    const argv = connector("feishu").args({
      target: "张三",
      limit: 10,
      options: { outputDir: "/tmp/out" },
    });

    expect(argv).toEqual([
      "--format",
      "json",
      "--name",
      "张三",
      "--output-dir",
      "/tmp/out",
      "--msg-limit",
      "10",
    ]);
  });
});

describe("the Python collectors", () => {
  /** The four collectors that implement the normalised JSON exit. */
  const JSON_COLLECTORS = [
    "feishu_auto_collector.py",
    "dingtalk_auto_collector.py",
    "slack_auto_collector.py",
    "email_parser.py",
  ];

  /**
   * Runs a collector with `--help`.
   *
   * Returns `null` when the tool cannot start at all (a missing third-party
   * dependency, for instance) — the CLI is then simply not checkable here.
   */
  const help = (tool: string): string | null => {
    const result = spawnSync(ENV.pythonPath, [`tools/${tool}`, "--help"], {
      cwd: ENV.skillEngineDir,
      encoding: "utf-8",
    });
    if (result.status !== 0 && /请先安装|ModuleNotFoundError/.test(result.stderr)) {
      return null;
    }
    expect(result.status, `${tool} --help failed: ${result.stderr}`).toBe(0);
    return result.stdout;
  };

  it("offer the normalised JSON exit", () => {
    for (const tool of JSON_COLLECTORS) {
      const output = help(tool);
      if (output === null) continue;
      expect(output, `${tool} must offer --format json`).toContain("--format");
      expect(output, `${tool} must offer --format json`).toContain("json");
    }
  });

  it("print one JSON object and report progress for the e-mail collector", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "mirrai-collector-test-"));
    const file = path.join(dir, "mail.mbox");
    writeFileSync(
      file,
      [
        "From zhangsan@company.com Mon Jan  1 10:00:00 2024",
        "From: zhangsan@company.com",
        "To: lisi@company.com",
        "Subject: =?utf-8?B?5pa55qGI6K+E5a6h?=",
        "Date: Mon, 01 Jan 2024 10:00:00 +0800",
        "Content-Type: text/plain; charset=\"utf-8\"",
        "",
        "这是正文内容。",
        "",
      ].join("\n"),
      "utf-8",
    );

    try {
      const result = spawnSync(
        ENV.pythonPath,
        [
          "tools/email_parser.py",
          "--file",
          file,
          "--target",
          "zhangsan@company.com",
          "--format",
          "json",
        ],
        { cwd: ENV.skillEngineDir, encoding: "utf-8" },
      );

      expect(result.status, result.stderr).toBe(0);

      // Exactly one JSON object on stdout.
      const payload = JSON.parse(result.stdout) as {
        messages: Array<{ role: string; content: string; timestamp: string; source: string }>;
        meta: { total: number; source: string; truncated: boolean };
      };
      expect(payload.messages).toHaveLength(1);
      expect(payload.messages[0]).toMatchObject({
        role: "assistant",
        content: "方案评审\n这是正文内容。",
        source: "email",
      });
      expect(payload.messages[0].timestamp).toBe("2024-01-01T10:00:00+08:00");
      expect(payload.meta).toEqual({ total: 1, source: "email", truncated: false });

      // The progress protocol drives the UI progress bar.
      expect(result.stderr).toMatch(/\[PROGRESS\] 0\.\d+/);
      expect(result.stderr).toMatch(/\[PROGRESS\] 1\.00/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keep the default output free of progress lines", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "mirrai-collector-test-"));
    const file = path.join(dir, "mail.mbox");
    writeFileSync(
      file,
      [
        "From zhangsan@company.com Mon Jan  1 10:00:00 2024",
        "From: zhangsan@company.com",
        "Subject: hello",
        "Date: Mon, 01 Jan 2024 10:00:00 +0800",
        "Content-Type: text/plain; charset=\"utf-8\"",
        "",
        "这是正文内容。",
        "",
      ].join("\n"),
      "utf-8",
    );

    try {
      const result = spawnSync(
        ENV.pythonPath,
        ["tools/email_parser.py", "--file", file, "--target", "zhangsan@company.com"],
        { cwd: ENV.skillEngineDir, encoding: "utf-8" },
      );

      expect(result.status, result.stderr).toBe(0);
      // The human-readable report is unchanged: no progress line on stdout.
      expect(result.stdout).not.toContain("[PROGRESS]");
      expect(result.stdout.startsWith("# 邮件提取结果")).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("the quality thresholds", () => {
  /** Reads the thresholds the Python side reports. */
  const pythonThresholds = (): Record<string, Record<string, number>> => {
    const script = [
      "import json, sys",
      "sys.path.insert(0, 'tools')",
      "from skill_presets import get_quality_thresholds",
      "profiles = ['budget-friendly', 'budget-unfriendly']",
      "print(json.dumps({p: get_quality_thresholds(p) for p in profiles}))",
    ].join("\n");

    const result = spawnSync(ENV.pythonPath, ["-c", script], {
      cwd: ENV.skillEngineDir,
      encoding: "utf-8",
    });

    if (result.status !== 0) {
      throw new Error(`python failed: ${result.stderr}`);
    }
    return JSON.parse(result.stdout) as Record<string, Record<string, number>>;
  };

  it("are declared once, in prompts/registry.json", () => {
    const registryPath = path.resolve(ENV.skillEngineDir, "prompts", "registry.json");
    const registry = JSON.parse(readFileSync(registryPath, "utf-8")) as {
      qualityThresholds?: Record<string, Record<string, number>>;
    };

    expect(registry.qualityThresholds, "registry.json must declare the thresholds").toBeDefined();
    expect(registry.qualityThresholds).toEqual(pythonThresholds());
  });
});

describe("collector job runner", () => {
  it("moves a job from queued to running to completed", async () => {
    const connector = fakeConnector("feishu", async () => ({
      messages: [{ role: "assistant", content: "hi" }],
    }));
    configureCollectors([connector]);

    const statuses: string[] = [];
    const unsubscribe = onJobUpdate((job) => statuses.push(job.status));

    const handle = await enqueueCollectorJob({
      userId: "user-1",
      personaId: "persona-1",
      source: "feishu",
      input: { target: "张三" },
    });

    expect(handle.job.status).toBe("queued");

    const finished = await waitForCollectorJob(handle.id, 5000);
    unsubscribe();

    expect(finished.status).toBe("completed");
    expect(finished.messageCount).toBe(1);
    expect(finished.progress).toBe(100);
    expect(finished.startedAt).toBeTruthy();
    expect(finished.finishedAt).toBeTruthy();
    expect(statuses).toEqual(["queued", "running", "completed"]);
  });

  it("never runs more than one collector at a time", async () => {
    let active = 0;
    let maxActive = 0;
    const track = async (): Promise<void> => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 20));
      active -= 1;
    };

    configureCollectors([
      fakeConnector("feishu", async () => {
        await track();
        return { messages: [] };
      }),
      fakeConnector("slack", async () => {
        await track();
        return { messages: [] };
      }),
      fakeConnector("dingtalk", async () => {
        await track();
        return { messages: [] };
      }),
    ]);

    const handles = await Promise.all(
      ["feishu", "slack", "dingtalk"].map((source) =>
        enqueueCollectorJob({
          userId: "user-1",
          personaId: "persona-1",
          source: source as CollectorSourceId,
          input: {},
        }),
      ),
    );

    const finished = await Promise.all(
      handles.map((handle) => waitForCollectorJob(handle.id, 5000)),
    );

    expect(finished.every((job) => job.status === "completed")).toBe(true);
    expect(maxActive).toBe(1);
  });

  it("marks a failing collector as failed with an error message", async () => {
    configureCollectors([
      fakeConnector("email", async () => {
        throw new Error("工具执行失败");
      }),
    ]);

    const handle = await enqueueCollectorJob({
      userId: "user-2",
      personaId: "persona-2",
      source: "email",
      input: {},
    });

    const finished = await waitForCollectorJob(handle.id, 5000);

    expect(finished.status).toBe("failed");
    expect(finished.error).toContain("工具执行失败");
    expect(finished.messageCount).toBe(0);
  });

  it("exposes jobs by id and per user", async () => {
    configureCollectors([fakeConnector("slack", async () => ({ messages: [] }))]);

    const handle = await enqueueCollectorJob({
      userId: "user-3",
      personaId: "persona-3",
      source: "slack",
      input: {},
    });
    await waitForCollectorJob(handle.id, 5000);

    expect(getCollectorJob(handle.id)?.status).toBe("completed");
    expect(getCollectorJob("does-not-exist")).toBeUndefined();
    expect(listCollectorJobs("user-3").some((job) => job.id === handle.id)).toBe(true);
    expect(listCollectorJobs("user-other").some((job) => job.id === handle.id)).toBe(false);
  });

  it("marks a running job as interrupted on reconcile", async () => {
    // A collector that never settles keeps the job in "running".
    configureCollectors([
      fakeConnector("feishu", () => new Promise<{ messages: [] }>(() => undefined)),
    ]);

    const handle = await enqueueCollectorJob({
      userId: "user-4",
      personaId: "persona-4",
      source: "feishu",
      input: {},
    });

    await waitFor(() => getCollectorJob(handle.id)?.status === "running");

    const reconciled = reconcileInterruptedJobs();

    expect(reconciled.some((job) => job.id === handle.id)).toBe(true);
    expect(getCollectorJob(handle.id)?.status).toBe("interrupted");
  });
});

/**
 * A timestamp that names a wall clock but no zone.
 *
 * It is the user's own clock — it is their chat history. It used to be
 * read in the *server's* zone, so on a server in another country every
 * message landed at the wrong hour, and often on the wrong day.
 */
describe("a timestamp with no zone in it", () => {
  it("is read in the reader's own zone", () => {
    const raw = JSON.stringify([
      { sender: "张三", content: "早", timestamp: "2026-03-01 08:30" },
    ]);
    const result = normaliseCollectorOutput(raw, "feishu", {
      target: "李四",
      timeZone: "Asia/Shanghai",
    });
    expect(result.messages[0].timestamp).toBe("2026-03-01T00:30:00.000Z");
  });

  it("is read in the reader's own zone on the other side of the world", () => {
    const raw = JSON.stringify([
      { sender: "张三", content: "早", timestamp: "2026-03-01 08:30" },
    ]);
    const result = normaliseCollectorOutput(raw, "feishu", {
      target: "李四",
      timeZone: "America/New_York",
    });
    // New York is five hours behind Greenwich in March.
    expect(result.messages[0].timestamp).toBe("2026-03-01T13:30:00.000Z");
  });
});
