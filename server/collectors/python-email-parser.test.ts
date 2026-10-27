import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import path from "path";

/**
 * The e-mail body.
 *
 * Two things went wrong in it, and both of them made mails disappear.
 *
 * The first was a rule of three or more underscores on a line of its
 * own — the way Outlook and Foxmail draw the line above a signature.
 * The clean-up deleted everything *after* that line, so the second
 * half of the mail (the conclusion, the action items) was gone, and
 * the user was told nothing.
 *
 * The second was a multipart mail whose text/plain part is empty and
 * whose real body is the text/html part — a very common shape. The
 * plain branch stopped the walk even though it had found nothing, so
 * the HTML part was never read and the mail contributed nothing.
 */

const TOOLS = path.resolve(process.cwd(), "skill-engine/tools");

function python(): string | null {
  for (const candidate of ["python3", "python"]) {
    try {
      execFileSync(candidate, ["--version"], { stdio: "ignore" });
      return candidate;
    } catch {
      // Try the next one.
    }
  }
  return null;
}

const PYTHON = python();

/** Runs a snippet with the tools directory on the path. */
function runPython(body: string): { status: number | null; out: string; err: string } {
  const result = spawnSync(PYTHON!, ["-c", body], { encoding: "utf-8" });
  return {
    status: result.status,
    out: result.stdout ?? "",
    err: result.stderr ?? "",
  };
}

describe.skipIf(!PYTHON)("the e-mail body", () => {
  it("keeps the text that comes after a signature rule", () => {
    const body = `
import sys, email, email.policy
sys.path.insert(0, ${JSON.stringify(TOOLS)})
import email_parser as m

raw = (
    "From: zhangsan@example.com\\r\\n"
    "Subject: S\\r\\n"
    "Date: Mon, 1 Jan 2026 00:00:00 +0000\\r\\n"
    "Content-Type: text/plain; charset=utf-8\\r\\n"
    "\\r\\n"
    "第一段正文\\n"
    "\\n"
    "___\\n"
    "\\n"
    "第二段正文：这是结论\\n"
)
msg = email.message_from_bytes(raw.encode("utf-8"), policy=email.policy.default)
import json
print("BODY:", json.dumps(m.extract_email_body(msg), ensure_ascii=False))
`;
    const result = runPython(body);
    expect(result.err).toBe("");
    /**
     * The rule is a divider, not a "the rest of the mail is a
     * signature" marker: the text below it is the mail.
     */
    expect(result.out).toContain("第二段正文");
    expect(result.out).toContain("这是结论");
  });

  it("still removes the rule itself", () => {
    const body = `
import sys, email, email.policy
sys.path.insert(0, ${JSON.stringify(TOOLS)})
import email_parser as m

raw = (
    "From: zhangsan@example.com\\r\\n"
    "Subject: S\\r\\n"
    "Date: Mon, 1 Jan 2026 00:00:00 +0000\\r\\n"
    "Content-Type: text/plain; charset=utf-8\\r\\n"
    "\\r\\n"
    "正文\\n"
    "\\n"
    "___\\n"
)
msg = email.message_from_bytes(raw.encode("utf-8"), policy=email.policy.default)
import json
print("BODY:", json.dumps(m.extract_email_body(msg), ensure_ascii=False))
`;
    const result = runPython(body);
    expect(result.out).not.toContain("___");
    expect(result.out).toContain("正文");
  });

  it("reads the HTML part when the plain part is empty", () => {
    const body = `
import sys, email, email.policy
sys.path.insert(0, ${JSON.stringify(TOOLS)})
import email_parser as m

raw = (
    "From: zhangsan@example.com\\r\\n"
    "Subject: S\\r\\n"
    "Date: Mon, 1 Jan 2026 00:00:00 +0000\\r\\n"
    'Content-Type: multipart/alternative; boundary="B"\\r\\n'
    "\\r\\n"
    "--B\\r\\n"
    "Content-Type: text/plain; charset=utf-8\\r\\n"
    "\\r\\n"
    "\\r\\n"
    "--B\\r\\n"
    "Content-Type: text/html; charset=utf-8\\r\\n"
    "\\r\\n"
    "<p>真正的正文</p>\\r\\n"
    "--B--\\r\\n"
)
msg = email.message_from_bytes(raw.encode("utf-8"), policy=email.policy.default)
import json
print("BODY:", json.dumps(m.extract_email_body(msg), ensure_ascii=False))
`;
    const result = runPython(body);
    expect(result.err).toBe("");
    /**
     * The plain part was empty, so the walk has to go on to the HTML
     * part — that is where the mail is.
     */
    expect(result.out).toContain("真正的正文");
  });
});
