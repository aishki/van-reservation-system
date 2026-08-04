import { sql } from "kysely";
import { afterAll, expect, it } from "vitest";
import { testDb } from "../../../test/with-rollback";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

it("connects to Postgres and reports the Asia/Manila offset", async () => {
  const result = await sql<{
    offset: string;
  }>`select to_char(now() at time zone 'Asia/Manila' - now() at time zone 'UTC', 'HH24') as offset`.execute(
    db,
  );
  expect(result.rows[0]?.offset).toBe("08");
});
