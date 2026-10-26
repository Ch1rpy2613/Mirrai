export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

/**
 * Where to send somebody who is not signed in.
 *
 * The page they were on is kept, so that signing in brings them back
 * to it. It used to be dropped: so a person who followed a link into
 * the app, was asked to sign in, and signed in landed on the lobby
 * with no idea where they had meant to go.
 */
export const getLoginUrl = () => {
  if (typeof window === "undefined") return "/login";
  const path = window.location.pathname + window.location.search;
  if (!path || path === "/" || path.startsWith("/login")) return "/login";
  return `/login?next=${encodeURIComponent(path)}`;
};
