/**
 * A failure, in a form that is safe to show.
 *
 * The distillation writes the reason a run failed into the job — and
 * the interface shows it, because "the analysis failed" tells the user
 * nothing and they cannot tell a bad key from a bad upload.
 *
 * But the reason is a provider's error, and a provider's error carries
 * the endpoint it was called at and, sometimes, the key that was
 * refused. So the raw error is not shown: the URLs are removed, the
 * long opaque tokens are removed, and what is left is the part that
 * helps.
 */

/** What a long opaque token looks like: twenty characters or more of nothing else. */
const TOKEN = /\b[A-Za-z0-9_-]{20,}\b/g;

/** A URL of any shape. */
const URL = /\b[a-z][a-z0-9+.-]*:\/\/\S+/gi;

/** A key, named the way keys are named. */
const NAMED_KEY = /\b(sk|pk|api|key|token|secret|bearer)[-_]?[A-Za-z0-9_-]{8,}\b/gi;

/**
 * The reason, with the dangerous parts taken out.
 *
 * The provider's own message is kept — it is the part that says
 * "401" or "model not found" — but the address it was called at and
 * the credentials are not.
 */
export function safeErrorMessage(error: unknown): string {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : (() => {
            try {
              return JSON.stringify(error);
            } catch {
              return "unknown error";
            }
          })();

  const text = raw || "unknown error";

  return text
    .replace(URL, "[the endpoint]")
    .replace(NAMED_KEY, "$1=[hidden]")
    // A long run of letters and digits is a key, a token or a hash.
    .replace(TOKEN, (match) => {
      // A word in capitals is a name, not a secret.
      if (match === match.toUpperCase() && /[A-Z]/.test(match)) return match;
      return "[hidden]";
    })
    .slice(0, 400)
    .trim();
}
