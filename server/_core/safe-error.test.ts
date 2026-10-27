import { describe, expect, it } from "vitest";
import { safeErrorMessage } from "./safe-error";

describe("safeErrorMessage", () => {
  it("keeps the part that helps", () => {
    const message = safeErrorMessage(new Error("401 Unauthorized: invalid api key"));
    expect(message).toContain("401");
    expect(message).toContain("Unauthorized");
  });

  it("removes the endpoint", () => {
    const message = safeErrorMessage(
      new Error("connect ECONNREFUSED http://127.0.0.1:3999/v1/chat/completions"),
    );
    expect(message).not.toContain("127.0.0.1");
    expect(message).not.toContain("3999");
    expect(message).toContain("[the endpoint]");
  });

  it("removes a key", () => {
    const message = safeErrorMessage(new Error("rejected sk-abcdefghijklmnopqrstuvwxyz012345"));
    expect(message).not.toContain("abcdefghijklmnopqrstuvwxyz");
  });

  it("removes a long opaque token", () => {
    const message = safeErrorMessage(new Error("token a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"));
    expect(message).not.toContain("a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6");
  });

  it("keeps a name in capitals", () => {
    const message = safeErrorMessage(new Error("model ANTHROPIC_CLAUDE not found"));
    expect(message).toContain("ANTHROPIC_CLAUDE");
  });

  it("removes the path of the machine the app runs on", () => {
    /**
     * The collector's failure is a Python traceback, and a traceback
     * says where the tool lives — so the operator's home directory and
     * the layout of their machine were shown in the browser.
     */
    const message = safeErrorMessage(
      new Error(
        'File "/Users/someone/Mirrai/skill-engine/tools/feishu_auto_collector.py", line 120',
      ),
    );
    expect(message).not.toContain("/Users/someone");
    expect(message).not.toContain("Mirrai");
    expect(message).toContain("[the path]");
  });

  it("removes a Windows path too", () => {
    const message = safeErrorMessage(
      new Error('File "C:\\Users\\someone\\Mirrai\\tools\\x.py", line 3'),
    );
    expect(message).not.toContain("someone");
    expect(message).toContain("[the path]");
  });

  it("takes anything at all", () => {
    expect(safeErrorMessage(undefined)).toBeTruthy();
    expect(safeErrorMessage({ weird: true })).toContain("weird");
    expect(safeErrorMessage("plain").length).toBeGreaterThan(0);
  });
});
