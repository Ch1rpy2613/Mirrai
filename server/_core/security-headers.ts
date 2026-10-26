/**
 * The headers every response carries.
 *
 * The app serves the user's own files — chat logs, photos, synthesised
 * speech — from `/uploads`, and it serves them from the same origin as
 * the app itself. So the browser's own decisions about what a
 * response is matter a great deal here, and the app was not making any
 * of them:
 *
 * - Without `X-Content-Type-Options: nosniff` a browser may look at the
 *   bytes and decide that a file named `photo.jpg` is really HTML. The
 *   extension is checked when the file is uploaded, but the *content*
 *   is not — a user can upload anything under a name the app accepts.
 *   A response sniffed as HTML runs in the app's origin.
 *
 * - Without `X-Frame-Options` any site on the internet can put the app
 *   in a frame and click on it on the user's behalf.
 *
 * - Without `Referrer-Policy` the address of a page the user is on —
 *   which may be a private conversation — is sent to every link the
 *   page carries.
 *
 * The frame policy follows `ALLOWED_ORIGINS`: an operator who has said
 * that Mirrai is embedded in another host gets that host in the list,
 * and everybody else gets the app's own origin only.
 */
import type { Request, Response, NextFunction } from "express";
import { ENV } from "./env";

/**
 * The value of the `Content-Security-Policy` header.
 *
 * The policy is deliberately narrow: the app's own assets, and nothing
 * else. It is not a lock-down of the whole app — the styles are set
 * inline by React, so `style-src` has to allow them — but it does mean
 * that a file the user uploaded can never be a script.
 */
export function contentSecurityPolicy(): string {
  const frameAncestors = ["'self'", ...ENV.allowedOrigins];
  return [
    "default-src 'self'",
    // The styles are set inline by React, so they have to be allowed.
    "style-src 'self' 'unsafe-inline'",
    "script-src 'self'",
    // The app talks to its own server and to nothing else. A file the
    // user uploaded is a file the user uploaded, and it is never a
    // script and never a frame.
    "connect-src 'self'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    `frame-ancestors ${frameAncestors.join(" ")}`,
  ].join("; ");
}

/**
 * Express middleware that sets the headers.
 */
export function securityHeaders(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  // The app needs the clipboard, the microphone (for the voice notes)
  // and the notifications. Nothing else.
  res.setHeader(
    "Permissions-Policy",
    "camera=(), geolocation=(), interest-cohort=(), microphone=(self)",
  );
  res.setHeader("Content-Security-Policy", contentSecurityPolicy());
  next();
}
