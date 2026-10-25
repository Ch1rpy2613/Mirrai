/**
 * The gap list the intake stage produced.
 *
 * The distillation pipeline starts by taking stock of the material and
 * naming what is missing from it. The answer is stored on the job row's
 * `inputMeta`, so the interface can show it — the user learns what to
 * upload next instead of wondering why the persona came out thin.
 *
 * The function is pure so the extraction can be tested without a browser.
 */

/** Reads the gap list out of a job's `inputMeta`. */
export function resolveIntakeGaps(inputMeta: unknown): string | null {
  if (!inputMeta || typeof inputMeta !== "object") return null;
  const intake = (inputMeta as Record<string, unknown>).intake;
  if (typeof intake !== "string") return null;
  const trimmed = intake.trim();
  return trimmed.length > 0 ? trimmed : null;
}
