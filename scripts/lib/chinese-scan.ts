/**
 * The scanner that keeps the server's languages honest.
 *
 * The interface was translated; the server was not. Every error toast,
 * every push notification, every prompt the server sends to a model — all
 * of it was written in Chinese, so an English user got an English app that
 * answered in Chinese whenever anything went wrong.
 *
 * This module answers one question:
 *
 *   **Is there a Chinese string in the server that has no English
 *   counterpart?**
 *
 * A Chinese string that sits in a `zh` property whose object also has an
 * `en` property is a copy table — it is bilingual by construction. Anything
 * else is a person about to read Chinese in an English app.
 *
 * There is one exception, and it is deliberate: a list of words the app
 * *matches against* what the user typed. The crisis keywords are Chinese
 * because a Chinese speaker writes them in Chinese; the role markers of a
 * pasted chat transcript are Chinese because that is how the transcripts
 * are written. Those declarations are marked with a comment:
 *
 * ```ts
 * // i18n:allow-input — these are matched against what the user typed.
 * const CRISIS_TERMS_ZH = ["自杀", …];
 * ```
 *
 * The marker is per declaration, not per file, so a new Chinese string
 * that is not a keyword list is still caught.
 *
 * The `wechat` directory is skipped by name. `server/wechat/**` is a hard
 * constraint — the WeChat protocol implementation has to stay byte for byte
 * what it was — and its messages are the WeChat ones, which are Chinese.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";

/** The Chinese range. */
const HAN = /[一-鿿]/;

/** The marker that exempts a declaration. */
const INPUT_MARKER = "i18n:allow-input";

export interface ChineseStringHit {
  /** The file, relative to the root that was scanned. */
  file: string;
  /** The line the string is on, counting from 1. */
  line: number;
  /** The source line, trimmed. */
  text: string;
}

export interface ScanOptions {
  /** Directory names that are never scanned. */
  skipDirs?: string[];
  /** File names (without a path) that are never scanned. */
  skipFiles?: string[];
}

const DEFAULT_SKIP_DIRS = ["node_modules", ".git", "dist", "drizzle", "wechat"];
const DEFAULT_SKIP_FILES: string[] = [];

/** Every source file under a directory. */
function* walk(dir: string, options: Required<ScanOptions>): Generator<string> {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (options.skipDirs.includes(name)) continue;
    const full = join(dir, name);
    let stats;
    try {
      stats = statSync(full);
    } catch {
      continue;
    }
    if (stats.isDirectory()) {
      yield* walk(full, options);
    } else if (
      /\.(ts|tsx)$/.test(name) &&
      !/\.(test|spec)\.tsx?$/.test(name) &&
      !options.skipFiles.includes(name)
    ) {
      yield full;
    }
  }
}

/** Whether an object literal has a property with that name. */
function hasProperty(object: ts.Node | undefined, name: string): boolean {
  if (!object || !ts.isObjectLiteralExpression(object)) return false;
  return object.properties.some(
    (property) =>
      ts.isPropertyAssignment(property) &&
      ts.isIdentifier(property.name) &&
      property.name.text === name,
  );
}

/** Whether a property of an object literal has a non-empty string value. */
function propertyIsText(object: ts.Node | undefined, name: string): boolean {
  if (!object || !ts.isObjectLiteralExpression(object)) return false;
  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    if (!ts.isIdentifier(property.name) && !ts.isStringLiteral(property.name)) continue;
    if (property.name.text !== name) continue;
    const value = property.initializer;
    if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) {
      return value.text.trim().length > 0;
    }
  }
  return false;
}

/**
 * Whether a string literal is part of a bilingual copy table.
 *
 * Two shapes occur: a flat one (`{ zh: "…", en: "…" }`) and a nested one
 * (`{ zh: { … }, en: { … } }`).
 */
function belongsToCopyTable(node: ts.Node): boolean {
  const parent = node.parent;
  if (!parent || !ts.isPropertyAssignment(parent)) return false;

  // Flat: { zh: "…", en: "…" }
  if (ts.isIdentifier(parent.name) && parent.name.text === "zh") {
    return propertyIsText(parent.parent, "en");
  }

  // Nested: { zh: { key: "…" }, en: { … } }
  const owner = parent.parent;
  if (!owner || !ts.isObjectLiteralExpression(owner)) return false;
  const ownerProperty = owner.parent;
  if (
    !ownerProperty ||
    !ts.isPropertyAssignment(ownerProperty) ||
    !ts.isIdentifier(ownerProperty.name) ||
    ownerProperty.name.text !== "zh" ||
    ownerProperty.initializer !== owner
  ) {
    return false;
  }
  return hasProperty(ownerProperty.parent, "en");
}

/**
 * Whether the declaration a string belongs to is marked as input matching.
 *
 * The marker is looked for in the comment that sits directly above the
 * declaration, so it applies to that declaration and nothing else.
 */
function isMarkedAsInputMatching(node: ts.Node, source: string): boolean {
  let current: ts.Node | undefined = node;
  while (
    current &&
    !ts.isVariableStatement(current) &&
    !ts.isPropertyDeclaration(current) &&
    !ts.isExportDeclaration(current) &&
    !ts.isFunctionDeclaration(current)
  ) {
    current = current.parent;
  }
  if (!current) return false;
  const comments = ts.getLeadingCommentRanges(source, current.getFullStart()) ?? [];
  return comments.some((comment) => source.slice(comment.pos, comment.end).includes(INPUT_MARKER));
}

/**
 * The Chinese strings in one file that have no English counterpart.
 */
export function bareChineseInSource(source: string, fileName: string): ChineseStringHit[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const hits: ChineseStringHit[] = [];
  const lines = source.split("\n");

  const record = (node: ts.Node, text: string) => {
    if (!HAN.test(text)) return;
    if (belongsToCopyTable(node)) return;
    if (isMarkedAsInputMatching(node, source)) return;
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    hits.push({ file: fileName, line: line + 1, text: (lines[line] ?? "").trim() });
  };

  const visit = (node: ts.Node) => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      record(node, node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hits;
}

/**
 * Scans a directory for Chinese strings with no English counterpart.
 *
 * The paths in the result are relative to `root`.
 */
export function scanForBareChinese(
  root: string,
  options: ScanOptions = {},
): ChineseStringHit[] {
  const resolved: Required<ScanOptions> = {
    skipDirs: options.skipDirs ?? DEFAULT_SKIP_DIRS,
    skipFiles: options.skipFiles ?? DEFAULT_SKIP_FILES,
  };

  const hits: ChineseStringHit[] = [];
  for (const file of walk(root, resolved)) {
    const source = readFileSync(file, "utf8");
    const relativePath = relative(root, file);
    for (const hit of bareChineseInSource(source, relativePath)) {
      hits.push(hit);
    }
  }
  return hits;
}
