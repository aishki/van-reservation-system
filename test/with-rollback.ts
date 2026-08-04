// Test files run in worker threads that do not inherit whatever the global
// setup's own `dotenv/config` put into the main process's environment, so each
// worker loads it again. Harmless when it is already present: dotenv never
// overrides an existing variable.
import "dotenv/config";
import type { Kysely, Transaction } from "kysely";
import { resolveTestDatabaseUrl } from "@/lib/db-url";
import { createDb } from "@/modules/db/client";
import type { DB } from "@/modules/db/types";

class Rollback extends Error {
  constructor() {
    super("intentional test rollback");
  }
}

export function testDb(): Kysely<DB> {
  return createDb(resolveTestDatabaseUrl(process.env) as string);
}

export async function withRollback(
  db: Kysely<DB>,
  fn: (trx: Transaction<DB>) => Promise<void>,
): Promise<void> {
  try {
    await db.transaction().execute(async (trx) => {
      await fn(trx);
      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
}
