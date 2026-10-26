/**
 * Untrusted material, fenced for the model.
 *
 * The fence itself lives in `server/_core/material.ts`, because the
 * farewell needs it too: everything that is distilled from an uploaded
 * chat log is material, and it all has to say so.
 */
export { asMaterial } from "../_core/material";
