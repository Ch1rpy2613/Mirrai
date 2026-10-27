/**
 * Untrusted material, fenced for the model.
 *
 * The fence itself lives in `shared/material.ts`, because the letter
 * instruction needs it too, and the letter is written in the same
 * module as the rest of the shared letter logic.
 */
export { asMaterial, materialNonce } from "@shared/material";
