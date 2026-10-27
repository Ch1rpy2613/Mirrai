import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * The distillation's write-back.
 *
 * The persona's own fields are one column, so writing them is a read
 * and a write of the whole thing — and every other path that writes
 * them takes the persona's lock.
 *
 * The distillation did not: so a correction typed in the persona editor
 * while the run was going was written, the toast said it was applied,
 * and a minute later the run finished and put the persona back exactly
 * as it was before the correction.
 */

const updatePersona = vi.fn();
const getPersonaById = vi.fn();

vi.mock("../db", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  updatePersona: (...a: unknown[]) => updatePersona(...a),
  getPersonaById: (...a: unknown[]) => getPersonaById(...a),
}));

vi.mock("../_core/lock", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  withPersonaDataLock: vi.fn(async (_personaId: number, work: () => Promise<unknown>) => work()),
}));

import { withPersonaDataLock } from "../_core/lock";
import { readFileSync } from "node:fs";
import path from "node:path";

const SOURCE = readFileSync(path.resolve(__dirname, "pipeline.ts"), "utf-8");

describe("the distillation's write-back", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("is taken under the persona's lock", () => {
    /**
     * The lock is what makes the read and the write one thing: without
     * it, anything written between the two is written away.
     */
    expect(SOURCE).toContain("withPersonaDataLock(personaId, async () => {");
  });

  it("takes the lock before it reads and releases it after it writes", () => {
    const lockAt = SOURCE.indexOf("await withPersonaDataLock(personaId, async () => {");
    const readAt = SOURCE.indexOf("const previous = await (async () => {", lockAt);
    const writeAt = SOURCE.indexOf("await db.updatePersona(personaId, userId, {", readAt);
    const releaseAt = SOURCE.indexOf("});", writeAt);

    expect(lockAt).toBeGreaterThan(-1);
    expect(readAt).toBeGreaterThan(lockAt);
    expect(writeAt).toBeGreaterThan(readAt);
    expect(releaseAt).toBeGreaterThan(writeAt);
  });

  it("does not hold the lock over a model call", () => {
    /**
     * The memory extraction is a model call — and it writes memories,
     * not the persona's fields. So it runs before the lock is taken:
     * the lock is not held for the length of a model call, and the
     * editor is not locked out of the persona while it runs.
     */
    const lockAt = SOURCE.indexOf("await withPersonaDataLock(personaId, async () => {");
    const extractionAt = SOURCE.indexOf("The facts in the upload become memories.");
    expect(extractionAt).toBeGreaterThan(-1);
    expect(extractionAt).toBeLessThan(lockAt);
  });

  it("the lock is the same one the router takes", () => {
    // Two locks would be two queues, and the two paths would not take
    // turns with each other.
    const router = readFileSync(path.resolve(__dirname, "../routers.ts"), "utf-8");
    expect(router).toContain('from "./_core/lock"');
    expect(SOURCE).toContain('from "../_core/lock"');
  });
});
