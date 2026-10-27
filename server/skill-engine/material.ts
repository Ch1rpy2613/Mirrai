/**
 * Untrusted material, fenced for the model.
 *
 * The fence itself lives in `server/_core/material.ts`, because the
 * farewell needs it too: everything that is distilled from an uploaded
 * chat log is material, and it all has to say so.
 */
export { asMaterial } from "../_core/material";

import { asMaterial as fence } from "../_core/material";
import type { Locale } from "@shared/copy";

/**
 * The person's name, fenced for the model.
 *
 * The name is the user's own writing — and a PNG character card is
 * somebody else's writing, imported whole. It reached the prompt with
 * no fence at all, immediately after the sentence that introduces it:
 * "Person's name: {name}".
 *
 * So one imported card could put words into the prompt of every
 * distillation that followed — and what came out of it went into the
 * persona the user then talks to, and into the exported skill package.
 *
 * The material in the very same prompts is already fenced; the name
 * was the one field that was not.
 */
export function fencedName(name: string, locale: Locale = "zh"): string {
  return fence(name, locale);
}
