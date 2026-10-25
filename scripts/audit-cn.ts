/**
 * The command line face of the Chinese scanner.
 *
 * It answers the question the guard test in `server/i18n.test.ts` asks:
 * which files still hold Chinese that has no English counterpart?
 *
 * Usage:
 *   pnpm audit:i18n                # the summary
 *   pnpm audit:i18n -- --list      # every offending line
 *   pnpm audit:i18n -- server      # only one directory
 */
import { join, relative } from "node:path";
import { scanForBareChinese } from "./lib/chinese-scan";

const ROOT = join(import.meta.dirname, "..");

const args = process.argv.slice(2);
const list = args.includes("--list");
const roots = args.filter((arg) => !arg.startsWith("--"));
const targets = roots.length ? roots : ["server"];

let total = 0;
/** Every hit, so the listing does not have to scan a second time. */
const hits: Array<{ file: string; line: number; text: string }> = [];
const perFile = new Map<string, number>();

for (const target of targets) {
  const found = scanForBareChinese(join(ROOT, target));
  for (const hit of found) {
    perFile.set(hit.file, (perFile.get(hit.file) ?? 0) + 1);
    hits.push(hit);
    total++;
  }
}

const files = [...perFile.entries()].sort((a, b) => b[1] - a[1]);
for (const [file, count] of files) {
  console.log(`${String(count).padStart(4)}  ${relative(ROOT, join(ROOT, file))}`);
  if (list) {
    for (const hit of hits.filter((entry) => entry.file === file)) {
      console.log(`      ${hit.line}: ${hit.text}`);
    }
  }
}
console.log(
  `\n${total} Chinese strings without an English counterpart, in ${files.length} files.`,
);

if (total > 0) process.exitCode = 1;
