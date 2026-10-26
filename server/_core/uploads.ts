/**
 * Access control for the uploads directory.
 *
 * Uploaded material — chat logs, photos, voice notes, synthesised speech —
 * is private to the user who uploaded it. Serving the directory statically
 * made all of it reachable by anyone who knew (or guessed) a URL.
 *
 * The layout encodes the owner in the path:
 *   personas/<userId>/<personaId>/<file>
 *   chat/<userId>/<personaId>/<file>
 *   tts/<userId>/<hash>.mp3
 *   tts/legacy/<hash>.mp3     (pre-scoped files, kept for old history)
 */
import type { Request, Response, NextFunction } from "express";
import { authenticateRequest } from "./auth";
import { userHasMessageWithMediaUrl } from "../db";

/** Prefixes whose second path segment is the owning user's id. */
const USER_SCOPED = new Set(["personas", "chat", "tts"]);

/**
 * Decides whether a storage key belongs to a user.
 */
export function isOwnedByUser(relKey: string, userId: number): boolean {
  const parts = relKey.replace(/^\/+/, "").split("/");
  if (parts.length < 2) return false;

  const [scope, owner] = parts;

  if (scope === "tts") {
    // Files written before TTS output was scoped per user.
    //
    // They have no owner in their path, so the path cannot say whose
    // they are — and their names are the hash of the text they were
    // made from, so two people who asked for the same words share one
    // file. Every signed-in user could fetch it.
    //
    // They are served to the people whose own conversation points at
    // them: `legacyFileBelongsToUser` checks that.
    if (owner === "legacy") return false;
    return owner === String(userId);
  }

  if (USER_SCOPED.has(scope)) {
    return owner === String(userId);
  }

  return false;
}

/**
 * Whether a file written before the TTS output was scoped belongs to a
 * user.
 *
 * It belongs to the people whose own conversation points at it.
 */
export async function legacyFileBelongsToUser(
  relKey: string,
  userId: number,
): Promise<boolean> {
  const parts = relKey.replace(/^\/+/, "").split("/");
  if (parts.length < 3 || parts[0] !== "tts" || parts[1] !== "legacy") return false;
  const url = `/uploads/${parts.join("/")}`;
  return userHasMessageWithMediaUrl(userId, url);
}

/**
 * Express middleware guarding `/uploads`.
 */
export function uploadsAuthGuard(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  // A malformed percent-escape makes `decodeURIComponent` throw. That must
  // not become a 500 — the path is simply not a key we know.
  let relKey: string;
  try {
    relKey = decodeURIComponent(req.path.replace(/^\/+/, ""));
  } catch {
    res.status(404).json({ error: "Not found" });
    return;
  }

  /**
   * The files are private.
   *
   * The static server marks them as `public`, which tells every proxy
   * between here and the user that the answer may be kept and shared.
   * These are the user's own photographs and chat logs.
   */
  res.setHeader("Cache-Control", "private, no-store");

  authenticateRequest(req)
    .then(async (user) => {
      const owned = isOwnedByUser(relKey, user.id) ||
        (await legacyFileBelongsToUser(relKey, user.id));
      if (!owned) {
        // 404 rather than 403: a stranger should not learn that the file
        // exists.
        res.status(404).json({ error: "Not found" });
        return;
      }
      next();
    })
    .catch(() => {
      res.status(401).json({ error: "Authentication required" });
    });
}
