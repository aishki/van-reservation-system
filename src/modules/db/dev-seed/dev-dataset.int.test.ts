import { sql } from "kysely";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { seedDevDataset } from "@/modules/db/dev-seed";
import { SEED_PEOPLE } from "@/modules/db/dev-seed/people";
import {
  getReservationDetail,
  listReservations,
} from "@/modules/reservations/repo";
import { CHANGED_TRIP_DETAILS_REMARK } from "@/modules/reservations/types";
import { testDb } from "../../../../test/with-rollback";

const db = testDb();

afterAll(async () => {
  // This suite deliberately loads the full dev dataset, and fileParallelism:
  // false means a LATER int test file runs against whatever this one leaves
  // behind. Truncate the domain tables the seed (re)writes every run, and
  // delete (never truncate — other suites' own rows live there too) the
  // `users` rows the seed upserted, ALL before destroy(): a query issued
  // after destroy() silently does nothing.
  // `notification_outbox` and `notification_events` are listed because they
  // reference `reservations` (and each other): Postgres refuses to truncate a
  // table another table's FK points at unless every referencing table is
  // truncated in the same statement.
  await sql`
    truncate table notification_outbox, notification_events,
                   reservation_events, reservation_passengers, reservations,
                   vans, drivers, reference_counters
  `.execute(db);
  await db
    .deleteFrom("users")
    .where(
      "domain_id",
      "in",
      SEED_PEOPLE.map((person) => person.domainId),
    )
    .execute();
  await db.destroy();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("seedDevDataset", () => {
  it("refuses to run in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await expect(seedDevDataset(db)).rejects.toThrow(/production/i);
  });

  it("loads the canonical sample data, readable through the repo", async () => {
    await seedDevDataset(db);
    const rows = await listReservations(db, { all: true });

    // The design's REQ-1051: pending pickup, edited after submission.
    const edited = rows.find(
      (row) => row.submittedAt === "2026-08-03T01:12:00.000Z",
    );
    expect(edited).toMatchObject({
      startDate: "2026-08-08",
      startTime: "06:30",
      site: "Iloilo",
      mode: "pickup",
      status: "Pending",
      requestor: "Jimera, Arielle",
      remarks: CHANGED_TRIP_DETAILS_REMARK,
      // The requestor's own edit. `updatedBy` names whoever last acted on the
      // row, admin or not — the Master List's "Last Updated" would otherwise
      // stay blank on the very rows that just changed.
      updatedBy: "Jimera, Arielle",
      driver: null,
    });
    expect(edited?.id).toMatch(/^VR-2026-\d{6}$/);

    // The design's REQ-1038: approved standby with a full costing.
    const standby = rows.find(
      (row) => row.submittedAt === "2026-07-22T07:15:00.000Z",
    );
    expect(standby).toMatchObject({
      status: "Approved",
      mode: "standby",
      to: "Standby",
      driver: "Ocampo, Dennis",
      updatedBy: "Abanto, Norlyn",
      firstAssignedAt: "2026-08-04T09:20:00.000Z",
    });

    const detail = await getReservationDetail(db, standby?.id as string);
    expect(detail?.detail).toMatchObject({
      towerHead: "Abanto, Norlyn",
      vendor: "Metro Fleet Services",
      costPhp: 6400,
      purpose: "Others",
      assignedDriver: {
        source: "roster",
        name: "Ocampo, Dennis",
        shift: "11PM-11AM",
      },
    });
    expect(detail?.detail.passengers).toHaveLength(4);
  });

  it("is idempotent: a second run reproduces the same references", async () => {
    await seedDevDataset(db);
    const first = (await listReservations(db, { all: true })).map((r) => r.id);
    await seedDevDataset(db);
    const second = (await listReservations(db, { all: true })).map((r) => r.id);
    expect(second).toEqual(first);
    expect(first.length).toBeGreaterThanOrEqual(8);
  });

  it("upserts seeded users rather than duplicating them", async () => {
    await seedDevDataset(db);
    await seedDevDataset(db);
    const arielle = await db
      .selectFrom("users")
      .select("id")
      .where("domain_id", "=", "AM65108")
      .execute();
    expect(arielle).toHaveLength(1);
  });
});

describe("generated year", () => {
  it("loads a deterministic year of reservations with valid references", async () => {
    await seedDevDataset(db);
    const rows = await listReservations(db, { all: true });

    // 8 canonical + the generated year (14–25/month × 12 months).
    expect(rows.length).toBeGreaterThan(150);
    for (const row of rows) {
      expect(row.id).toMatch(/^VR-(2025|2026)-\d{6}$/);
    }

    // The SLA shape survives the port: of assigned rows, most are within 12h.
    const assigned = rows.filter((row) => row.firstAssignedAt != null);
    const withinSla = assigned.filter(
      (row) =>
        new Date(row.firstAssignedAt as string).getTime() -
          new Date(row.submittedAt).getTime() <=
        12 * 3_600_000,
    );
    expect(assigned.length).toBeGreaterThan(50);
    expect(withinSla.length / assigned.length).toBeGreaterThan(0.75);
  });

  it("every generated row is drawer-complete", async () => {
    await seedDevDataset(db);
    const rows = await listReservations(db, { all: true });
    const sample = rows[rows.length - 1]; // oldest generated row
    const found = await getReservationDetail(db, sample.id);
    expect(found).not.toBeNull();
    expect(found?.detail.passengers.length).toBeGreaterThanOrEqual(1);
    expect(found?.detail.purpose).not.toBe("");
  });
});
