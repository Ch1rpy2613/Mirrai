/**
 * What the farewell dialog does when the user backs out.
 *
 * In the "suggest" flow the app offered the farewell and the user is
 * declining it — that has to be recorded, or the app would offer it again
 * on the next turn.
 *
 * In the "manual" flow nobody offered anything: the user opened the dialog
 * themselves and is simply changing their mind. Recording it would mark
 * the persona as "declined", which closes the very door the manual mode
 * exists to keep open.
 */

/** Whether backing out of the dialog counts as declining the farewell. */
export function declinesOnCancel(variant: "suggest" | "manual"): boolean {
  return variant === "suggest";
}
