import "dotenv/config";
import { defineConfig, getKnexTimestampPrefix } from "kysely-ctl";
import { Pool } from "pg";
// A relative path, not `@/lib/db-url`: this file is loaded by jiti, outside the
// app's own build and its alias resolution. db-url.ts imports nothing itself,
// which is what keeps that safe.
import { resolveDatabaseUrl, schemaFromUrl } from "../src/lib/db-url";

// Not `env()` from src/lib/env.ts, for the same reason.
function requireDatabaseUrl(): string {
  const url = resolveDatabaseUrl(process.env);
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set, and DB_HOST / DB_NAME / DB_USER are not all " +
        "present to compose one. `pg` would otherwise fall back to libpq " +
        "defaults (commonly localhost:5432) and silently migrate/seed " +
        "whatever Postgres is listening there. Set them in .env before " +
        "running kysely-ctl commands.",
    );
  }
  return url;
}

/**
 * The schema DB_SCHEMA pins, or undefined. Deliberately does not throw when the
 * connection is unconfigured: `db:migrate:make` writes a file and must keep
 * working with no database at all.
 */
function migrationSchema(): string | undefined {
  const url = resolveDatabaseUrl(process.env);
  return url ? (schemaFromUrl(url) ?? undefined) : undefined;
}

export default defineConfig({
  dialect: "pg",
  dialectConfig: {
    // Kysely's PostgresDialect requires a `pool`, not a raw connectionString.
    // Factory form: the pool (and the DATABASE_URL check) is only built when
    // a command actually runs a query, so DB-less commands like
    // `db:migrate:make` don't require DATABASE_URL to be set at all.
    pool: async () => new Pool({ connectionString: requireDatabaseUrl() }),
  },
  migrations: {
    // kysely-ctl resolves relative paths against this config file's own
    // directory (.config/), not the repo root, so "../" is required here.
    migrationFolder: "../src/modules/db/migrations",
    getMigrationPrefix: getKnexTimestampPrefix,
    // Pins the bookkeeping tables to the same schema as everything else, but
    // only when one is configured — Kysely cannot change this value later.
    // Left undefined, the migrator matches `kysely_migration_lock` by name in
    // ANY schema, so a same-named table belonging to another project sharing
    // the database would be mistaken for ours.
    migrationTableSchema: migrationSchema(),
  },
  seeds: {
    seedFolder: "../src/modules/db/seeds",
  },
});
