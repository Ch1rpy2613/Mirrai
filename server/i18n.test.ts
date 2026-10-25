import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { bareChineseInSource, scanForBareChinese } from "../scripts/lib/chinese-scan";

/**
 * The app speaks two languages.
 *
 * The interface was translated and the server was not: every error toast,
 * every push notification, every prompt the server sent to a model, and
 * every line of the questionnaire were written in Chinese. An English user
 * got an English app that answered in Chinese the moment anything went
 * wrong — which is exactly the moment the wording has to be clear.
 *
 * The words now live in the copy table (`shared/copy/`), where each entry
 * carries both languages. This test is the guard: a Chinese string in the
 * app that has no English counterpart is a bug, and it is a bug that
 * nothing else would catch — a missing translation does not crash
 * anything, it just quietly falls back to Chinese.
 *
 * It covers the **whole** app, not only the server. The interface had its
 * own version of the same problem — the picture and voice placeholders
 * were written in Chinese in the component while the server wrote them in
 * the reader's language, so the English app showed a stray "[image]" under
 * every picture — and a guard that only watched the server would never
 * have seen it.
 *
 * There are two exceptions, and both are deliberate:
 *
 *   - a list of words the app matches against what the user typed. Those
 *     declarations are marked with `i18n:allow-input`, and the marker is
 *     per declaration, so a new Chinese string that is not a keyword list
 *     is still caught.
 *   - a value that is stored rather than read — the name a row in the
 *     database has. Those are marked with `i18n:allow-identifier`.
 */
const ROOT = join(__dirname, "..");

/** The directories the app is made of. */
const APP = ["server", "client", "shared"];

describe("the app's languages", () => {
  it("has no Chinese without an English counterpart", () => {
    const hits = APP.flatMap((dir) => scanForBareChinese(join(ROOT, dir)));
    const report = hits
      .map((hit) => `${hit.file}:${hit.line}  ${hit.text}`)
      .join("\n");
    expect(
      report,
      `Chinese without an English counterpart:\n${report}`,
    ).toBe("");
  });

  it("watches the interface as well as the server", () => {
    // The guard is only worth something if it looks at the whole app. A
    // test that watched the server alone would have passed while the
    // interface was still writing Chinese.
    const client = scanForBareChinese(join(ROOT, "client"));
    expect(client).toEqual([]);
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

  it("knows a copy table that holds a list", () => {
    // The output contracts are a list of lines, and the list is joined
    // into one string. Both halves are there, so neither is a leftover.
    const source = [
      "const COPY = {",
      '  contract: {',
      '    zh: ["第一行", "第二行"].join("\\n"),',
      '    en: ["First line", "Second line"].join("\\n"),',
      "  },",
      "};",
    ].join("\n");
    expect(bareChineseInSource(source, "example.ts")).toEqual([]);
  });

  it("knows a table that pairs a name with its translation", () => {
    // The scenes and the intimacy levels are `{ name, nameEn }`, not
    // `{ zh, en }`.
    const source = [
      "const LEVELS = [",
      '  { key: "acquainted", name: "初识", nameEn: "Acquainted" },',
      "];",
    ].join("\n");
    expect(bareChineseInSource(source, "example.ts")).toEqual([]);
  });

  it("does not let a key pass for text", () => {
    // `{ "肯定的言辞": MessageCircle }` is a lookup table. The key is an
    // identifier, not something anybody reads.
    const source = 'const ICONS = { "肯定的言辞": MessageCircle };';
    expect(bareChineseInSource(source, "example.ts")).toEqual([]);
  });

  it("catches a Chinese string that is not in a copy table", () => {
    const source = 'const message = "分身还未准备好";';
    const hits = bareChineseInSource(source, "example.ts");
    expect(hits).toHaveLength(1);
    expect(hits[0].line).toBe(1);
  });

  it("catches Chinese in the English half of a copy table", () => {
    // The `en` side is not exempt. A Chinese string in it would be a
    // person reading Chinese in an English app.
    const source = [
      "const COPY = {",
      '  title: { zh: "标题", en: "标题" },',
      "};",
    ].join("\n");
    const hits = bareChineseInSource(source, "example.ts");
    expect(hits).toHaveLength(1);
  });

  it("lets a marked keyword list through", () => {
    const source = [
      "// i18n:allow-input — matched against what the user typed.",
      'const CRISIS_TERMS_ZH = ["自杀", "不想活"];',
    ].join("\n");
    expect(bareChineseInSource(source, "example.ts")).toEqual([]);
  });

  it("lets a marked stored value through", () => {
    // A value that identifies a row is not something anybody reads.
    const source = [
      "// i18n:allow-identifier — this is what the rows in the database say.",
      'const STYLES = [{ value: "安全型", labelKey: "styles.secure" }];',
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
