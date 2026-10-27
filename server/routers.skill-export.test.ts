import { describe, expect, it, vi, beforeEach } from "vitest";
import type { TrpcContext } from "./_core/context";

/**
 * Exporting a skill package.
 *
 * The error the user saw was the error the server had — and that error
 * carried the server's absolute paths, the path of the Python
 * interpreter and the Python traceback. So the browser was told where
 * the server's files are.
 */

const getSkillJobById = vi.fn();

vi.mock("./db", () => ({
  getSkillJobById: (...a: unknown[]) => getSkillJobById(...a),
}));

const exportSkillToHost = vi.fn();

vi.mock("./skill-engine/skill-export", () => ({
  exportSkillToHost: (...a: unknown[]) => exportSkillToHost(...a),
}));

import { appRouter } from "./routers";

function ctxFor(userId: number): TrpcContext {
  return {
    user: {
      id: userId,
      username: `user-${userId}`,
      passwordHash: null,
      openId: null,
      email: null,
      loginMethod: "local",
      role: "user",
      tokenVersion: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
      name: `User ${userId}`,
      timezone: null,
      locale: "zh",
    },
    req: {} as any,
    res: {} as any,
  } as unknown as TrpcContext;
}

describe("exporting a skill package", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSkillJobById.mockResolvedValue({
      id: 3,
      userId: 1,
      generatedSkillPath: "/Users/someone/Library/Application Support/Mirrai/skills/job-3",
    });
  });

  it("does not show the server's paths when the export fails", async () => {
    exportSkillToHost.mockRejectedValue(
      new Error(
        'Command failed: /usr/local/bin/python3 tools/install_claude_generated_skill.py\n' +
          'Traceback (most recent call last):\n' +
          '  File "/Users/someone/Library/Application Support/Mirrai/skill-engine/tools/install.py", line 12\n' +
          'ModuleNotFoundError: No module named "toml"',
      ),
    );

    const error = await appRouter
      .createCaller(ctxFor(1))
      .skillEngine.exportSkill({ jobId: 3, host: "claude-code" })
      .catch((e: any) => e);

    const message = String(error?.message ?? "");
    expect(message).not.toContain("/Users/someone");
    expect(message).not.toContain("python3");
    expect(message).not.toContain("Traceback");
    expect(message).not.toContain("ModuleNotFoundError");
    // And it says what the user can do.
    expect(message).toContain("Python");
  });
});
