import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { bareChineseInSource, scanForBareChinese } from "../scripts/lib/chinese-scan";

/**
 * The server speaks two languages.
 *
 * The interface was translated and the server was not: every error toast,
 * every push notification, every prompt the server sent to a model, and
 * every line of the questionnaire were written in Chinese. An English user
 * got an English app that answered in Chinese the moment anything went
 * wrong — which is exactly the moment the wording has to be clear.
 *
 * The words now live in the copy table (`shared/copy/`), where each entry
 * carries both languages. This test is the guard: a Chinese string in the
 * server that has no English counterpart is a bug, and it is a bug that
 * nothing else would catch — a missing translation does not crash
 * anything, it just quietly falls back to Chinese.
 *
 * The one exception is a list of words the app matches against what the
 * user typed. Those declarations are marked with `i18n:allow-input`, and
 * the marker is per declaration, so a new Chinese string that is not a
 * keyword list is still caught.
 */
const ROOT = join(__dirname, "..");

describe("the server's languages", () => {
  it("has no Chinese without an English counterpart", () => {
    const hits = scanForBareChinese(join(ROOT, "server"));
    const report = hits
      .map((hit) => `${hit.file}:${hit.line}  ${hit.text}`)
      .join("\n");
    expect(
      report,
      `Chinese without an English counterpart:\n${report}`,
    ).toBe("");
  });

  it("leaves the WeChat protocol alone", () => {
    // `server/wechat/**` is a hard constraint: every byte of it stays as
    // it is, because the protocol implementation depends on it. The scanner
    // skips the directory by name.
    //
    // The check that matters is that the exclusion is deliberate: with the
    // directory included, the scan does find Chinese there. If it found
    // nothing, the exclusion would be hiding a change nobody made.
    const included = scanForBareChinese(join(ROOT, "server"), {
      skipDirs: ["node_modules", ".git", "dist", "drizzle"],
      skipFiles: [],
    });
    const inWechat = included.filter((hit) => hit.file.startsWith("wechat/"));
    expect(inWechat.length).toBeGreaterThan(0);

    const excluded = scanForBareChinese(join(ROOT, "server"));
    expect(excluded.filter((hit) => hit.file.startsWith("wechat/"))).toEqual([]);
  });

  it("knows a bilingual copy table when it sees one", () => {
    // The scanner has to be able to tell a copy table from a leftover, or
    // it would either miss real problems or report every table.
    const source = [
      "const COPY = {",
      '  zh: { title: "记忆里程碑" },',
      '  en: { title: "Milestones" },',
      "};",
    ].join("\n");
    expect(bareChineseInSource(source, "example.ts")).toEqual([]);
  });

  it("catches a Chinese string that is not in a copy table", () => {
    const source = 'const message = "分身还未准备好";';
    const hits = bareChineseInSource(source, "example.ts");
    expect(hits).toHaveLength(1);
    expect(hits[0].line).toBe(1);
  });

  it("lets a marked keyword list through", () => {
    const source = [
      "// i18n:allow-input — matched against what the user typed.",
      'const CRISIS_TERMS_ZH = ["自杀", "不想活"];',
    ].join("\n");
    expect(bareChineseInSource(source, "example.ts")).toEqual([]);
  });

  it("does not let the marker leak to the next declaration", () => {
    // The marker is per declaration. A file that holds a keyword list and
    // then some ordinary copy still has to be caught.
    const source = [
      "// i18n:allow-input — matched against what the user typed.",
      'const CRISIS_TERMS_ZH = ["自杀"];',
      'const message = "分身还未准备好";',
    ].join("\n");
    const hits = bareChineseInSource(source, "example.ts");
    expect(hits).toHaveLength(1);
    expect(hits[0].line).toBe(3);
  });
});
