import type { Kysely, Updateable } from "kysely";
import { err, ok, type Result } from "@/lib/result";
import type { DB, Drivers } from "@/modules/db/types";
import type { Driver } from "@/modules/drivers/types";
import { SITE_TO_DB, siteFromDb } from "@/modules/reservations/db-map";
import {
  diffFields,
  type FieldSpec,
  recordRosterEvent,
} from "@/modules/roster/events";
import {
  ROSTER_MESSAGES,
  type RosterActor,
  type RosterFailure,
} from "@/modules/roster/types";
import type { DriverCreate, DriverPatch } from "@/modules/roster/wire";

function toDriver(row: {
  id: string;
  name: string;
  mobile: string;
  site: string;
  shift: string | null;
  active: boolean;
}): Driver {
  return {
    id: row.id,
    name: row.name,
    mobile: row.mobile,
    site: siteFromDb(row.site),
    // No translation: shift is free text, stored and rendered as typed.
    shift: row.shift,
    active: row.active,
  };
}

/**
 * The whole roster, inactive drivers included — the workload screen shows a
 * deactivated driver's history rather than pretending they never drove.
 */
export async function listDrivers(db: Kysely<DB>): Promise<Driver[]> {
  const rows = await db
    .selectFrom("drivers")
    .select(["id", "name", "mobile", "site", "shift", "active"])
    .orderBy("name", "asc")
    .execute();

  return rows.map(toDriver);
}

/**
 * The fields eligible for the audit trail, with the labels the log shows.
 *
 * An ALLOWLIST — `diffFields` iterates this rather than the row's own keys, so a
 * column added later cannot leak into a permanent log.
 */
const DRIVER_FIELDS: FieldSpec[] = [
  { field: "name", label: "Name" },
  { field: "mobile", label: "Mobile" },
  { field: "site", label: "Site" },
  { field: "shift", label: "Shift" },
];

export async function createDriver(
  db: Kysely<DB>,
  input: DriverCreate,
  actor: RosterActor,
): Promise<Result<Driver, RosterFailure>> {
  return db.transaction().execute(async (trx) => {
    const row = await trx
      .insertInto("drivers")
      .values({
        name: input.name,
        mobile: input.mobile,
        site: SITE_TO_DB[input.site],
        shift: input.shift,
      })
      .returning(["id", "name", "mobile", "site", "shift", "active"])
      .executeTakeFirstOrThrow();

    await recordRosterEvent(trx, {
      target: "drivers",
      targetId: row.id,
      eventType: "created",
      actor,
      // A creation is its own change; there is no before-state to diff.
      changes: null,
    });

    return ok(toDriver(row));
  });
}

export async function updateDriver(
  db: Kysely<DB>,
  id: string,
  input: DriverPatch,
  actor: RosterActor,
): Promise<Result<Driver, RosterFailure>> {
  return db.transaction().execute(async (trx) => {
    // Locked, so a concurrent edit cannot make the diff describe a state that
    // never existed.
    const before = await trx
      .selectFrom("drivers")
      .select(["id", "name", "mobile", "site", "shift", "active"])
      .where("id", "=", id)
      .forUpdate()
      .executeTakeFirst();

    if (before === undefined) {
      return err({ code: "NOT_FOUND", message: ROSTER_MESSAGES.notFound });
    }

    // Built from the patch's PRESENT keys only. An absent field means
    // "unchanged", never "set to null".
    const update: Updateable<Drivers> = {};
    if (input.name !== undefined) update.name = input.name;
    if (input.mobile !== undefined) update.mobile = input.mobile;
    if (input.site !== undefined) update.site = SITE_TO_DB[input.site];
    if (input.shift !== undefined) update.shift = input.shift;

    const changes = diffFields(
      { ...before, site: siteFromDb(before.site) },
      { ...input },
      DRIVER_FIELDS,
    );

    // Nothing moved: no write, and no event. An audit row for a change that did
    // not happen makes the whole log untrustworthy.
    if (changes.length === 0) return ok(toDriver(before));

    const row = await trx
      .updateTable("drivers")
      .set({ ...update, updated_at: new Date() })
      .where("id", "=", id)
      .returning(["id", "name", "mobile", "site", "shift", "active"])
      .executeTakeFirstOrThrow();

    await recordRosterEvent(trx, {
      target: "drivers",
      targetId: id,
      eventType: "updated",
      actor,
      changes,
    });

    return ok(toDriver(row));
  });
}

/**
 * Deactivation is the whole of retirement — there is no delete. The event type
 * is `deactivated` / `reactivated` rather than `updated`, because "who took this
 * driver off the roster" is the question the log is most often asked.
 *
 * Does NOT unassign anything. Trips already assigned keep their driver and stay
 * valid; the row simply takes no new assignments. `affectedTrips` is what shows
 * the operator the consequence beforehand.
 */
export async function setDriverActive(
  db: Kysely<DB>,
  id: string,
  active: boolean,
  actor: RosterActor,
): Promise<Result<Driver, RosterFailure>> {
  return db.transaction().execute(async (trx) => {
    // Read first, and `forUpdate` so a concurrent toggle cannot slip between
    // this and the write below.
    const before = await trx
      .selectFrom("drivers")
      .select(["id", "name", "mobile", "site", "shift", "active"])
      .where("id", "=", id)
      .forUpdate()
      .executeTakeFirst();

    if (before === undefined) {
      return err({ code: "NOT_FOUND", message: ROSTER_MESSAGES.notFound });
    }

    // Already in that state: no write, and no event — the same rule
    // `updateDriver` applies to an empty diff. Reachable from the UI, not just
    // the API: the roster table computes `!row.active` from cached query data,
    // so a stale row deactivates something already deactivated.
    if (before.active === active) return ok(toDriver(before));

    const row = await trx
      .updateTable("drivers")
      .set({ active, updated_at: new Date() })
      .where("id", "=", id)
      .returning(["id", "name", "mobile", "site", "shift", "active"])
      .executeTakeFirstOrThrow();

    await recordRosterEvent(trx, {
      target: "drivers",
      targetId: id,
      eventType: active ? "reactivated" : "deactivated",
      actor,
      changes: null,
    });

    return ok(toDriver(row));
  });
}
