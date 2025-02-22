import fs from "fs";
import path from "path";
import { ENV } from "../_core/env";

export function loadPrompt(family: string, stage: string): string {
  const familyPath = path.resolve(ENV.skillEngineDir, "prompts", family, `${stage}.md`);
  if (fs.existsSync(familyPath)) return fs.readFileSync(familyPath, "utf-8");

  const rootPath = path.resolve(ENV.skillEngineDir, "prompts", `${stage}.md`);
  if (fs.existsSync(rootPath)) return fs.readFileSync(rootPath, "utf-8");

  throw new Error(`Prompt not found: ${family}/${stage}`);
}
