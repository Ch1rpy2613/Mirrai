import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";

// Wrapper: run the live test script through tsx so the TypeScript ilink
// modules load directly (no build step, no import rewriting).
const out = execSync(
  `npx tsx scripts/live-wechat-test.mjs ${process.argv.slice(2).join(" ")}`,
  { encoding: "utf-8", stdio: "inherit" },
);
process.stdout.write(out);
