import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import { env } from "@/lib/env";
import type { DB } from "@/modules/db/types";

export function createDb(connectionString: string): Kysely<DB> {
  return new Kysely<DB>({
    dialect: new PostgresDialect({
      pool: new Pool({ connectionString, max: 10 }),
    }),
  });
}

let cached: Kysely<DB> | null = null;

export function getDb(): Kysely<DB> {
  if (cached === null) cached = createDb(env().DATABASE_URL);
  return cached;
}
