import type { Kysely, Updateable } from "kysely";
import { err, ok, type Result } from "@/lib/result";
import type { DB, Vans } from "@/modules/db/types";
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
import {
  fieldForConstraint,
  UNIQUE_VIOLATION,
  type VanCreate,
  type VanPatch,
} from "@/modules/roster/wire";
import type { Van } from "@/modules/vans/types";

function toVan(row: {
  id: string;
  van_number: string;
  plate: string;
  car_type: string;
  site: string;
  active: boolean;
}): Van {
  return {
    id: row.id,
    vanNumber: row.van_number,
    plate: row.plate,
    carType: row.car_type,
    site: siteFromDb(row.site),
    active: row.active,
  };
}

/**
 * The whole roster, inactive vans included — an old trip still has to show
 * the van that ran it.
 */
export async function listVans(db: Kysely<DB>): Promise<Van[]> {
  const rows = await db
    .selectFrom("vans")
    .select(["id", "van_number", "plate", "car_type", "site", "active"])
    .orderBy("van_number", "asc")
    .execute();

  return rows.map(toVan);
}

/**
 * The fields eligible for the audit trail, with the labels the log shows.
 *
 * An ALLOWLIST — `diffFields` iterates this rather than the row's own keys, so a
 * column added later cannot leak into a permanent log.
 */
const VAN_FIELDS: FieldSpec[] = [
  { field: "vanNumber", label: "Van number" },
  { field: "plate", label: "Plate" },
  { field: "carType", label: "Car type" },
  { field: "site", label: "Site" },
];

/**
 * A duplicate van number or plate, attributed to its input.
 *
 * Caught rather than pre-checked with a `select`: two concurrent creates both
 * see the plate free and one then fails anyway. The database is the only
 * authority on uniqueness.
 */
function asFailure(error: unknown): RosterFailure | null {
  const code = (error as { code?: string })?.code;
  if (code !== UNIQUE_VIOLATION) return null;

  const message = String((error as { message?: string })?.message ?? "");
  const field = fieldForConstraint(message);
  if (field === "vanNumber") {
    return {
      code: "VALIDATION_FAILED",
      message: ROSTER_MESSAGES.duplicateVanNumber,
      field,
    };
  }
  if (field === "plate") {
    return {
      code: "VALIDATION_FAILED",
      message: ROSTER_MESSAGES.duplicatePlate,
      field,
    };
  }
  // An unmapped violation is a real error, not something to blame on an
  // arbitrary input.
  return null;
}

export async function createVan(
  db: Kysely<DB>,
  input: VanCreate,
  actor: RosterActor,
): Promise<Result<Van, RosterFailure>> {
  try {
    return await db.transaction().execute(async (trx) => {
      const row = await trx
        .insertInto("vans")
        .values({
          van_number: input.vanNumber,
          plate: input.plate,
          car_type: input.carType,
          site: SITE_TO_DB[input.site],
        })
        .returning(["id", "van_number", "plate", "car_type", "site", "active"])
        .executeTakeFirstOrThrow();

      await recordRosterEvent(trx, {
        target: "vans",
        targetId: row.id,
        eventType: "created",
        actor,
        // A creation is its own change; there is no before-state to diff.
        changes: null,
      });

      return ok(toVan(row));
    });
  } catch (error) {
    const failure = asFailure(error);
    if (failure === null) throw error;
    return err(failure);
  }
}

export async function updateVan(
  db: Kysely<DB>,
  id: string,
  input: VanPatch,
  actor: RosterActor,
): Promise<Result<Van, RosterFailure>> {
  try {
    return await db.transaction().execute(async (trx) => {
      // Locked, so a concurrent edit cannot make the diff describe a state that
      // never existed.
      const before = await trx
        .selectFrom("vans")
        .select(["id", "van_number", "plate", "car_type", "site", "active"])
        .where("id", "=", id)
        .forUpdate()
        .executeTakeFirst();

      if (before === undefined) {
        return err({ code: "NOT_FOUND", message: ROSTER_MESSAGES.notFound });
      }

      // Built from the patch's PRESENT keys only. An absent field means
      // "unchanged", never "set to null".
      const update: Updateable<Vans> = {};
      if (input.vanNumber !== undefined) update.van_number = input.vanNumber;
      if (input.plate !== undefined) update.plate = input.plate;
      if (input.carType !== undefined) update.car_type = input.carType;
      if (input.site !== undefined) update.site = SITE_TO_DB[input.site];

      const changes = diffFields(
        {
          vanNumber: before.van_number,
          plate: before.plate,
          carType: before.car_type,
          site: siteFromDb(before.site),
        },
        { ...input },
        VAN_FIELDS,
      );

      // Nothing moved: no write, and no event. An audit row for a change that
      // did not happen makes the whole log untrustworthy.
      if (changes.length === 0) return ok(toVan(before));

      const row = await trx
        .updateTable("vans")
        .set({ ...update, updated_at: new Date() })
        .where("id", "=", id)
        .returning(["id", "van_number", "plate", "car_type", "site", "active"])
        .executeTakeFirstOrThrow();

      await recordRosterEvent(trx, {
        target: "vans",
        targetId: id,
        eventType: "updated",
        actor,
        changes,
      });

      return ok(toVan(row));
    });
  } catch (error) {
    const failure = asFailure(error);
    if (failure === null) throw error;
    return err(failure);
  }
}

/**
 * Retirement is the whole of deactivation — there is no delete. The event type
 * is `deactivated` / `reactivated` rather than `updated`, because "who took this
 * van off the roster" is the question the log is most often asked.
 *
 * Does NOT unassign anything. Trips already assigned keep their van and stay
 * valid; the row simply takes no new assignments.
 */
export async function setVanActive(
  db: Kysely<DB>,
  id: string,
  active: boolean,
  actor: RosterActor,
): Promise<Result<Van, RosterFailure>> {
  return db.transaction().execute(async (trx) => {
    // Read first, and `forUpdate` so a concurrent toggle cannot slip between
    // this and the write below.
    const before = await trx
      .selectFrom("vans")
      .select(["id", "van_number", "plate", "car_type", "site", "active"])
      .where("id", "=", id)
      .forUpdate()
      .executeTakeFirst();

    if (before === undefined) {
      return err({ code: "NOT_FOUND", message: ROSTER_MESSAGES.notFound });
    }

    // Already in that state: no write, and no event — see `setDriverActive`.
    if (before.active === active) return ok(toVan(before));

    const row = await trx
      .updateTable("vans")
      .set({ active, updated_at: new Date() })
      .where("id", "=", id)
      .returning(["id", "van_number", "plate", "car_type", "site", "active"])
      .executeTakeFirstOrThrow();

    await recordRosterEvent(trx, {
      target: "vans",
      targetId: id,
      eventType: active ? "reactivated" : "deactivated",
      actor,
      changes: null,
    });

    return ok(toVan(row));
  });
}
