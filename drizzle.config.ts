import { defineConfig } from "drizzle-kit";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required to run drizzle commands");
}

export default defineConfig({
  schema: "./drizzle/schema.ts",
  /**
   * Where drizzle-kit writes what it generates.
   *
   * It used to write into `./drizzle` — the same folder as the
   * hand-written migrations. And the journal it needs to know where it
   * is (`drizzle/meta/`) is not in the repository, so a fresh clone
   * started at zero and wrote over `0000_cheerful_darwin.sql`.
   *
   * The folder is its own now. Nothing in it is applied by the app —
   * `scripts/migrate.mjs` reads the `.sql` files beside it — so a
   * generated migration is a proposal, not a change.
   */
  out: "./drizzle/generated",
  dialect: "postgresql",
  dbCredentials: {
    url: connectionString,
  },
});
