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

const ADMIN_USERNAME = "admin";
const PASSWORD_LENGTH = 16;

/** Characters that are hard to confuse when read off a screen. */
const PASSWORD_ALPHABET = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%";

export function generatePassword(length = PASSWORD_LENGTH): string {
  const bytes = randomBytes(length);
  let password = "";
  for (let i = 0; i < length; i++) {
    password += PASSWORD_ALPHABET[bytes[i] % PASSWORD_ALPHABET.length];
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
    });

    const dataRoot = resolveDataRoot();
    if (!existsSync(dataRoot)) mkdirSync(dataRoot, { recursive: true });
    const credentialsPath = path.join(dataRoot, "first-run-credentials.txt");

    const contents = [
      "Mirrai 首次运行凭据 / Mirrai first-run credentials",
      "",
      `用户名 / Username: ${ADMIN_USERNAME}`,
      `密码 / Password:   ${password}`,
      "",
      "请登录后尽快修改密码。",
      "Please change this password after signing in.",
      "",
    ].join("\n");

    writeFileSync(credentialsPath, contents, { mode: 0o600 });

    console.log("");
    console.log("  ┌──────────────────────────────────────────────┐");
    console.log("  │  Mirrai 已创建本地管理员账号                  │");
    console.log("  │  A local administrator account was created    │");
    console.log("  └──────────────────────────────────────────────┘");
    console.log(`     用户名 / Username: ${ADMIN_USERNAME}`);
    console.log(`     密码   / Password: ${password}`);
    console.log(`     凭据文件 / Credentials file: ${credentialsPath}`);
    console.log("");

    return { created: true, username: ADMIN_USERNAME, password, credentialsPath };
  } catch (e) {
    console.error("[Bootstrap] Failed to create the administrator account:", e);
    return { created: false };
  }
}
