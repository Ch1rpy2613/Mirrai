export const COOKIE_NAME = "app_session_id";
export const ONE_YEAR_MS = 1000 * 60 * 60 * 24 * 365;

/**
 * The two error strings the server used to send.
 *
 * They were English, with an internal code in them, and they were
 * thrown as the error's message — so they were passed through to the
 * interface, and a Chinese user whose session had expired was told, in
 * a Chinese interface, in English, with a code number that means
 * nothing to them.
 *
 * They are gone. The sentences live in the shared copy table
 * (`errors.code.unauthorized` and `errors.code.forbidden`), and the
 * server picks the one for the reader's language.
 *
 * The interface used to compare the message with these strings to know
 * when the session was over. It cannot do that any more — the message
 * is translated now — so the machine-readable half moved into the
 * error's data, as `UNAUTHORIZED_MARKER` in `server/_core/trpc.ts`.
 */
