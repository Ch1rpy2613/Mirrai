import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";

const ROOT = path.resolve(__dirname, "..");
const WORKFLOW = path.join(ROOT, ".github", "workflows", "ci.yml");

/**
 * The checks the build runs.
 *
 * A check that cannot fail is worse than no check at all: it is read as
 * "this is covered", so the thing it was written for is never looked at
 * again. Two of them were like that — and both of them were about the
 * schema, which is the one thing a wrong change to breaks in a way
 * nobody notices until a user's install is wrong.
 */

function workflow(): string {
  return readFileSync(WORKFLOW, "utf-8");
}

/** The lines of one step, by the name above it. */
function step(name: string): string {
  const lines = workflow().split("\n");
  const at = lines.findIndex((line) => line.includes(`name: ${name}`));
  if (at === -1) throw new Error(`the workflow has no step called "${name}"`);
  const rest = lines.slice(at + 1);
  const end = rest.findIndex((line) => /^\s*- name: /.test(line));
  return (end === -1 ? rest : rest.slice(0, end)).join("\n");
}

/** Where a step sits among the steps, so the order can be checked. */
function stepOrder(name: string): number {
  const lines = workflow().split("\n");
  return lines.findIndex((line) => line.includes(`name: ${name}`));
}

describe("the schema check in the build", () => {
  it("compares the schema with the database the migrations produced", () => {
    /**
     * The database was built from `drizzle/schema.ts` one step earlier,
     * so comparing it with `drizzle/schema.ts` could never fail — it
     * was the same file, compared with itself.
     *
     * The thing worth checking is that the two ways of building the
     * schema agree: a fresh install builds it from `schema.ts`, and an
     * existing install applies the SQL files in `drizzle/`. If they
     * disagree, the same release behaves differently depending on when
     * it was installed.
     *
     * So the SQL files are applied first, and the schema is checked
     * against the result.
     */
    const apply = stepOrder("Apply schema");
    const migrations = stepOrder("Apply the SQL migrations on top of it");
    const check = stepOrder("Verify the schema is in sync");

    expect(apply).toBeGreaterThanOrEqual(0);
    expect(migrations).toBeGreaterThan(apply);
    expect(check).toBeGreaterThan(migrations);
  });

  it("really runs the migrations before it checks", () => {
    const migrations = step("Apply the SQL migrations on top of it");
    expect(migrations).toMatch(/db:migrate/);
  });
});

describe("the idempotency check in the build", () => {
  it("runs the SQL again, not the script", () => {
    /**
     * It ran the script twice — which was not a test of idempotency at
     * all: the second run read the journal, saw the work was done, and
     * did nothing. The claim is about the SQL, so the SQL is what has
     * to run again.
     */
    const check = step("Verify the SQL migrations are idempotent");
    expect(check).toMatch(/db:replay/);
    expect(check).not.toMatch(/db:migrate\s*\n\s*db:migrate/);
  });

  it("has a replay mode that ignores the journal", () => {
    const script = readFileSync(path.join(ROOT, "scripts", "migrate.mjs"), "utf-8");
    expect(script).toContain("--replay");
    /**
     * The journal is what makes the second run a no-op — so the replay
     * has to skip the check that reads it.
     */
    expect(script).toMatch(/if \(!replay && applied\.has\(file\.version\)\)/);
  });
});
