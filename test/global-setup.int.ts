import "dotenv/config";
import { promises as fs } from "node:fs";
import path from "node:path";
import { FileMigrationProvider, Migrator } from "kysely/migration";
import { Client } from "pg";
import {
  resolveDatabaseUrl,
  resolveTestDatabaseUrl,
  schemaFromUrl,
} from "@/lib/db-url";
import { createDb } from "@/modules/db/client";

function assertTestDatabaseIsolated(): string {
  const testUrl = resolveTestDatabaseUrl(process.env);
  const devUrl = resolveDatabaseUrl(process.env);

  if (!testUrl) {
    throw new Error("TEST_DATABASE_URL must be set to run integration tests");
  }
  if (testUrl === devUrl) {
    throw new Error(
      "TEST_DATABASE_URL must not equal DATABASE_URL — refusing to run migrations against the development database",
    );
  }
  if (!/test/i.test(testUrl)) {
    throw new Error(
      `TEST_DATABASE_URL ("${testUrl}") does not look like a test database (expected "test" in the name) — refusing to run migrations`,
    );
  }

  return testUrl;
}

/** Whether the target database can be reached at all. */
async function canConnect(url: string): Promise<boolean> {
  const client = new Client({ connectionString: url });
  try {
    await client.connect();
    await client.end();
    return true;
  } catch {
    return false;
  }
}

/**
 * `van_reservation_test` used to be created by hand
 * (`docker compose exec … createdb`), so a fresh clone or a CI runner with no
 * memory of that step could not run `pnpm test:int`.
 *
 * The connection is attempted FIRST, and the `postgres` maintenance database is
 * only opened when that fails. On a shared server the target database already
 * exists and the developer typically has neither CREATEDB nor the right to
 * connect to `postgres` at all — reaching for it unconditionally would fail a
 * run that had nothing wrong with it.
 *
 * The check-then-create is not atomic; two processes creating the same database
 * in the same instant would race. `vitest.int.config.ts` sets
 * `fileParallelism: false`, and this is a per-developer/per-CI-job database, so
 * that race is accepted rather than guarded with an advisory lock.
 */
async function ensureDatabaseExists(testUrl: string): Promise<void> {
  const target = new URL(testUrl);
  const dbName = target.pathname.replace(/^\//, "");
  if (!dbName) {
    throw new Error(`TEST_DATABASE_URL ("${testUrl}") has no database name`);
  }
  if (await canConnect(testUrl)) return;

  const maintenanceUrl = new URL(testUrl);
  maintenanceUrl.pathname = "/postgres";

  const client = new Client({ connectionString: maintenanceUrl.toString() });
  await client.connect();
  try {
    const { rowCount } = await client.query(
      "select 1 from pg_database where datname = $1",
      [dbName],
    );
    if (rowCount === 0) {
      // Database names can't be parameterized in DDL — escapeIdentifier quotes
      // it safely. `dbName` comes from TEST_DATABASE_URL, a developer-controlled
      // environment variable, not end-user input.
      await client.query(`create database ${client.escapeIdentifier(dbName)}`);
    }
  } finally {
    await client.end();
  }
}

/**
 * Creates the schema the test URL pins through `search_path`, when it pins one.
 *
 * This is the isolation mechanism on a server where you cannot create
 * databases: tests get their own SCHEMA beside the development one, in the same
 * database, and every unqualified statement resolves into it. A URL with no
 * `search_path` names no schema, so there is nothing to create.
 */
async function ensureSchemaExists(testUrl: string): Promise<void> {
  const schema = schemaFromUrl(testUrl);
  if (schema === null) return;

  const client = new Client({ connectionString: testUrl });
  await client.connect();
  try {
    await client.query(
      `create schema if not exists ${client.escapeIdentifier(schema)}`,
    );
  } finally {
    await client.end();
  }
}

export default async function setup() {
  const url = assertTestDatabaseIsolated();
  await ensureDatabaseExists(url);
  await ensureSchemaExists(url);

  const db = createDb(url);
  const migrator = new Migrator({
    db,
    provider: new FileMigrationProvider({
      fs,
      path,
      migrationFolder: path.resolve("src/modules/db/migrations"),
    }),
    // Only when the URL pins a schema, because Kysely warns that this value can
    // never change once used. Without it the migrator's existence check matches
    // `kysely_migration_lock` by NAME across every schema, finds the copy in
    // `public` left by the development database, skips creating one here, and
    // then fails to read it — the search_path points only at the test schema.
    migrationTableSchema: schemaFromUrl(url) ?? undefined,
  });

  const { error, results } = await migrator.migrateToLatest();
  await db.destroy();

  if (error) {
    const failed = results?.find((r) => r.status === "Error");
    throw new Error(
      `Test database migration failed${failed ? ` at ${failed.migrationName}` : ""}: ${String(error)}`,
    );
  }
}
