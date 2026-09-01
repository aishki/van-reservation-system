import type { Kysely } from "kysely";
import { seedDevDataset } from "@/modules/db/dev-seed";
import type { DB } from "@/modules/db/types";

/**
 * DEV ONLY — run via `pnpm db:seed:dev`. `pnpm db:seed` targets the admin
 * whitelist with --specific and never reaches this file; seedDevDataset
 * additionally refuses NODE_ENV=production.
 */
export async function seed(db: Kysely<DB>): Promise<void> {
  await seedDevDataset(db);
}
