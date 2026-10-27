import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

const getAllUserIds = vi.fn();
const createUser = vi.fn();
const hashPassword = vi.fn();

vi.mock("../db", () => ({
  getAllUserIds: (...a: unknown[]) => getAllUserIds(...(a as [])),
  createUser: (...a: unknown[]) => createUser(...(a as [])),
}));

vi.mock("../_core/password", () => ({
  hashPassword: (...a: unknown[]) => hashPassword(...(a as [])),
}));

import { bootstrapAdminAccount, generatePassword, resolveDataRoot } from "./bootstrap";
import { ENV } from "../_core/env";

let dataRoot: string;
let originalDataRoot: string | undefined;
let originalBootstrap: string | undefined;

beforeEach(() => {
  dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mirrai-bootstrap-"));
  originalDataRoot = ENV.dataRoot;
  originalBootstrap = ENV.bootstrapAdmin;
  ENV.dataRoot = dataRoot;
  ENV.bootstrapAdmin = "auto";

  getAllUserIds.mockReset();
  createUser.mockReset();
  hashPassword.mockReset();
  getAllUserIds.mockResolvedValue([]);
  createUser.mockResolvedValue(1);
  hashPassword.mockImplementation(async (password: string) => `hashed:${password}`);
});

afterEach(() => {
  ENV.dataRoot = originalDataRoot ?? "";
  ENV.bootstrapAdmin = (originalBootstrap ?? "auto") as "auto" | "manual";
  fs.rmSync(dataRoot, { recursive: true, force: true });
});

describe("generatePassword", () => {
  it("produces a password of the requested length", () => {
    expect(generatePassword(16)).toHaveLength(16);
    expect(generatePassword(24)).toHaveLength(24);
  });

  it("avoids characters that are easy to misread", () => {
    const password = generatePassword(64);
    expect(password).not.toMatch(/[0O1lI]/);
  });

  it("produces a different password each time", () => {
    const passwords = new Set(Array.from({ length: 20 }, () => generatePassword()));
    expect(passwords.size).toBeGreaterThan(1);
  });

  it("uses every character equally often", () => {
    /**
     * The characters are equally likely.
     *
     * It used to be `bytes[i] % alphabet.length` — and the alphabet
     * has 62 characters while a byte has 256 values, so 256 does not
     * divide by 62: the first eight characters came up about a quarter
     * more often than the rest. So the password was drawn from a
     * slightly smaller set than it looked like — and the password is
     * the one secret the operator has to copy off the screen by hand.
     *
     * The counting is over a lot of characters, so the test is about
     * the *shape* of the distribution and not about one draw: the
     * busiest character must not be noticeably busier than the
     * quietest one.
     */
    const alphabet = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%";
    const counts = new Map<string, number>();
    const rounds = 6000;
    for (let i = 0; i < rounds; i++) {
      for (const character of generatePassword(64)) {
        counts.set(character, (counts.get(character) ?? 0) + 1);
      }
    }
    const values = [...counts.values()];
    expect(values.length).toBe(alphabet.length);
    const busiest = Math.max(...values);
    const quietest = Math.min(...values);
    /**
     * With every character equally likely, the busiest and the
     * quietest differ by the sampling noise of a third of a million
     * draws — about 7% at the far ends.
     *
     * With the old modulo, the first eight characters were 25% ahead,
     * and this ratio would be 1.25.
     */
    expect(busiest / quietest).toBeLessThan(1.15);
  });
});

describe("resolveDataRoot", () => {
  it("uses the configured data root", () => {
    expect(resolveDataRoot()).toBe(path.resolve(dataRoot));
  });
});

describe("bootstrapAdminAccount", () => {
  it("creates an administrator on an empty instance", async () => {
    const result = await bootstrapAdminAccount();

    expect(result.created).toBe(true);
    expect(result.username).toBe("admin");
    expect(result.password).toBeTruthy();
    expect(createUser).toHaveBeenCalledTimes(1);
    expect(createUser.mock.calls[0][0].username).toBe("admin");
  });

  it("writes the credentials to a file only the owner can read (acceptance 0-I)", async () => {
    const result = await bootstrapAdminAccount();

    const credentialsPath = path.join(dataRoot, "first-run-credentials.txt");
    expect(fs.existsSync(credentialsPath)).toBe(true);

    // The mode has to be 0600 — the file holds a working password.
    const mode = fs.statSync(credentialsPath).mode & 0o777;
    expect(mode).toBe(0o600);

    const contents = fs.readFileSync(credentialsPath, "utf-8");
    expect(contents).toContain("admin");
    expect(contents).toContain(result.password!);
  });

  it("does not create a second account when one already exists", async () => {
    getAllUserIds.mockResolvedValue([1]);
    const result = await bootstrapAdminAccount();

    expect(result.created).toBe(false);
    expect(createUser).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(dataRoot, "first-run-credentials.txt"))).toBe(false);
  });

  it("does not recreate the account on a second start", async () => {
    const first = await bootstrapAdminAccount();
    expect(first.created).toBe(true);

    // The second start sees the account it just created.
    getAllUserIds.mockResolvedValue([1]);
    const second = await bootstrapAdminAccount();

    expect(second.created).toBe(false);
    expect(createUser).toHaveBeenCalledTimes(1);
  });

  it("does nothing when the operator asks to register manually", async () => {
    ENV.bootstrapAdmin = "manual";
    const result = await bootstrapAdminAccount();

    expect(result.created).toBe(false);
    expect(createUser).not.toHaveBeenCalled();
  });

  it("never throws when the database is unreachable", async () => {
    getAllUserIds.mockRejectedValue(new Error("connection refused"));
    const result = await bootstrapAdminAccount();

    expect(result.created).toBe(false);
    expect(createUser).not.toHaveBeenCalled();
  });
});
