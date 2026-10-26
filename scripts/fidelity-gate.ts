#!/usr/bin/env tsx
/**
 * The gate, runnable.
 *
 * The checks live in `server/_core/fidelity-gate.ts` so that they can be
 * tested — a gate whose own teeth are never checked is a gate that
 * might have stopped biting without anyone noticing. This is only the
 * reporting.
 *
 * Usage: pnpm fidelity:gate
 */
import { checkPersonaStructure, completePersona } from "../server/_core/fidelity-gate";

const result = checkPersonaStructure(completePersona());

if (result.ok) {
  console.log("[gate] the persona still has everything it needs:");
  for (const item of result.checks) console.log(`  ✓ ${item}`);
  console.log("");
  console.log("[gate] The fidelity measurement itself is not here — it needs");
  console.log("[gate] the person's records and a model, and it is sampled, so");
  console.log("[gate] it is run on their machine: pnpm eval -- --persona 1 --user 1");
  process.exit(0);
}

console.error("[gate] the persona lost something:");
for (const failure of result.failures) {
  console.error(`  ✗ ${failure.what}`);
  console.error(`      ${failure.why}`);
}
console.error("");
console.error("[gate] A gate that cannot be trusted is worse than no gate.");
process.exit(1);
