/**
 * First-run bootstrap.
 *
 * A self-hosted instance with no account is unusable, and a single-user
 * desktop install should not require the operator to click through a
 * registration form before anything works. When the database has no users at
 * all, this creates a local administrator and writes its credentials to a
 * file the operator can read.
 *
 * Set `MIRRAI_BOOTSTRAP_ADMIN=manual` to disable this and require
 * registration through the UI instead.
 */
import { randomBytes } from "crypto";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import path from "path";
import { ENV } from "../_core/env";
import { hashPassword } from "../_core/password";
import * as db from "../db";
import { copy, type CopyKey } from "@shared/copy";

const ADMIN_USERNAME = "admin";
const PASSWORD_LENGTH = 16;

/** Characters that are hard to confuse when read off a screen. */
const PASSWORD_ALPHABET = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%";

/**
 * A label in both languages, on one line.
 *
 * The first run has no interface to ask which language the operator
 * reads, so every label says both things. The Chinese comes first because
 * it is the product's original voice; `gap` is the number of spaces
 * before the separator, which is what lines the labels up in the console.
 */
/**
 * The key is typed, so a label that is not in the table is a compile
 * error.
 *
 * It was a plain string — so a typo in a label the operator reads once,
 * on the console, at first run, rendered as the key itself.
 */
function bilingual(key: CopyKey, gap = 1): string {
  const zh = copy("zh", key);
  const en = copy("en", key);
  return `${zh}${" ".repeat(gap)}/ ${en}`;
}

/**
 * The width of a line in terminal columns.
 *
 * A CJK character takes two columns, so a box drawn by counting the
 * characters does not line up.
 */
function displayWidth(text: string): number {
  let width = 0;
  for (const char of text) {
    const wide =
      /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6]/.test(char);
    width += wide ? 2 : 1;
  }
  return width;
}

/**
 * The administrator's password.
 *
 * Every character is equally likely.
 *
 * It used to be `bytes[i] % alphabet.length` — and the alphabet has 62
 * characters while a byte has 256 values, so 256 does not divide by 62:
 * the first eight characters came up about a quarter more often than
 * the rest. So the password was drawn from a *slightly* smaller set than
 * it looked like — and the password is the one secret the operator has
 * to copy off the screen by hand.
 *
 * So the bytes that do not divide evenly are drawn again: the ones from
 * 248 upwards are thrown away, and every character then has exactly
 * four chances out of the 248.
 */
export function generatePassword(length = PASSWORD_LENGTH): string {
  const alphabet = PASSWORD_ALPHABET;
  // The largest multiple of the alphabet's length that fits in a byte.
  const usable = 256 - (256 % alphabet.length);
  let password = "";
  while (password.length < length) {
    for (const byte of randomBytes(length)) {
      // A byte that does not divide evenly would favour the first few
      // characters — so it is not used.
      if (byte >= usable) continue;
      password += alphabet[byte % alphabet.length];
      if (password.length === length) break;
    }
  }
  return password;
}

/**
 * Where the credentials file is written.
 *
 * Defaults to a sibling of the uploads directory, which the desktop builds
 * already point at the per-user data directory.
 */
export function resolveDataRoot(): string {
  if (ENV.dataRoot) return path.resolve(ENV.dataRoot);
  return path.resolve(path.dirname(path.resolve(ENV.uploadDir)));
}

export interface BootstrapResult {
  created: boolean;
  username?: string;
  password?: string;
  credentialsPath?: string;
}

/**
 * Creates the first administrator when the instance has no users.
 *
 * Never throws: a failure here must not stop the server from booting — the
 * operator can still register through the UI.
 */
export async function bootstrapAdminAccount(): Promise<BootstrapResult> {
  if (ENV.bootstrapAdmin === "manual") {
    return { created: false };
  }

  try {
    const userIds = await db.getAllUserIds();
    if (userIds.length > 0) return { created: false };
  } catch (e) {
    console.warn("[Bootstrap] Could not check for existing users:", e);
    return { created: false };
  }

  try {
    const password = generatePassword();
    const passwordHash = await hashPassword(password);

    await db.createUser({
      username: ADMIN_USERNAME,
      passwordHash,
      name: "Administrator",
      // The account is called "admin" and it is the administrator's.
      // It was created with the default role — so it was an ordinary
      // account with a name that promised something else.
      role: "admin",
    });

    const dataRoot = resolveDataRoot();
    if (!existsSync(dataRoot)) mkdirSync(dataRoot, { recursive: true });
    const credentialsPath = path.join(dataRoot, "first-run-credentials.txt");

    const contents = [
      bilingual("labels.bootstrap.credentialsTitle"),
      "",
      `${bilingual("labels.bootstrap.username")}: ${ADMIN_USERNAME}`,
      `${bilingual("labels.bootstrap.password")}:   ${password}`,
      "",
      bilingual("labels.bootstrap.changePassword"),
      "",
    ].join("\n");

    writeFileSync(credentialsPath, contents, { mode: 0o600 });

    // The box is drawn from the two languages of the same sentence, so
    // the operator reads one of them and never has to guess which half of
    // a line is meant for them.
    const boxLines = [
      `  ${copy("zh", "labels.bootstrap.createdAccount")}`,
      `  ${copy("en", "labels.bootstrap.createdAccount")}`,
    ];
    const boxWidth = Math.max(...boxLines.map(displayWidth)) + 2;

    console.log("");
    console.log(`  ┌${"─".repeat(boxWidth)}┐`);
    for (const line of boxLines) {
      console.log(`  │${line}${" ".repeat(boxWidth - displayWidth(line))}│`);
    }
    console.log(`  └${"─".repeat(boxWidth)}┘`);
    console.log(`     ${bilingual("labels.bootstrap.username")}: ${ADMIN_USERNAME}`);
    console.log(`     ${bilingual("labels.bootstrap.password", 3)}: ${password}`);
    console.log(`     ${bilingual("labels.bootstrap.credentialsFile")}: ${credentialsPath}`);
    console.log("");

    return { created: true, username: ADMIN_USERNAME, password, credentialsPath };
  } catch (e) {
    console.error("[Bootstrap] Failed to create the administrator account:", e);
    return { created: false };
  }
}
