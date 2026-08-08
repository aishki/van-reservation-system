import { type Kysely, sql } from "kysely";
import type { DB } from "@/modules/db/types";

/** `VR-2026-000412` — the human-quotable handle emails and exports carry. */
export function formatReferenceNo(year: number, sequence: number): string {
  return `VR-${year}-${String(sequence).padStart(6, "0")}`;
}

/**
 * Issues the next reference for a year in ONE atomic statement, so two
 * concurrent submissions cannot draw the same number: the first insert for a
 * year returns 1; every conflict increments the stored counter and returns
 * the new value. The sequence resets per calendar year by keying on it.
 *
 * The caller decides the year from the submission instant in MANILA time
 * (`instantInManila(now).date.slice(0, 4)`) — a Dec 31 23:30 Manila
 * submission belongs to the closing year even though UTC has moved on.
 */
export async function nextReferenceNo(
  db: Kysely<DB>,
  year: number,
): Promise<string> {
  const row = await db
    .insertInto("reference_counters")
    .values({ year, next_value: 1 })
    .onConflict((oc) =>
      oc.column("year").doUpdateSet({
        next_value: sql`reference_counters.next_value + 1`,
      }),
    )
    .returning("next_value")
    .executeTakeFirstOrThrow();

  return formatReferenceNo(year, row.next_value);
}
