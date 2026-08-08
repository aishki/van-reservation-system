import type { Kysely } from "kysely";
import { instantInManila } from "@/lib/tz";
import type { DB } from "@/modules/db/types";
import { siteFromDb, statusFromDb } from "@/modules/reservations/db-map";
import {
  type AssignedDriver,
  type AssignedVan,
  CHANGED_TRIP_DETAILS_REMARK,
  type ReservationDetail,
  type ReservationRow,
  type RideMode,
  requestorFacingStatus,
} from "@/modules/reservations/types";

/**
 * Who may see what. Decided by the caller (route handler or page) from the
 * session — the repo trusts it, so no query built here may ever widen it.
 */
export type ReservationScope = { all: true } | { requestorUserId: string };

/** Who the projection is being built for. Decides the status vocabulary. */
type Audience = "admin" | "requestor";

/**
 * The three derived fields come from reservation_events, the single record
 * of what has happened to a request (see the spec's Approach A):
 *
 * - `has_modified`  → `remarks` ("Changed Trip Details")
 * - min(driver_assigned) → `firstAssignedAt` — the FIRST assignment only;
 *   `driver_reassigned` events deliberately do not move it (TAT/SLA basis)
 * - latest non-`submitted` event, by any actor → `updatedBy` / `updatedAt`
 */
function listQuery(db: Kysely<DB>) {
  return (
    db
      .selectFrom("reservations as r")
      .leftJoin("drivers as d", "d.id", "r.assigned_driver_id")
      .leftJoin("vans as v", "v.id", "r.assigned_van_id")
      // One row for updatedBy/updatedAt, not two independent subqueries: two
      // separate `order by created_at desc limit 1` subqueries are not
      // guaranteed to pick the SAME physical row on an exact created_at tie
      // between two different admin actors. A single lateral join fetches
      // both columns from whichever row Postgres picks, so they can never
      // disagree with each other.
      .leftJoinLateral(
        (eb) =>
          eb
            .selectFrom("reservation_events as e")
            .select(["e.actor_name", "e.created_at"])
            .whereRef("e.reservation_id", "=", "r.id")
            // Was `actor_role = 'admin_support'`. Widened because a requestor
            // cancelling their own approved trip is exactly the change an admin
            // scanning the Master List needs to see, and the old filter moved
            // neither column for it.
            //
            // `submitted` stays excluded: a submission is the row's creation,
            // not an update to it. `submittedAt` already carries that, and
            // without this every unreviewed request would name its own
            // requestor under "Updated by".
            .where("e.event_type", "<>", "submitted")
            .orderBy("e.created_at", "desc")
            .limit(1)
            .as("u"),
        (join) => join.onTrue(),
      )
      .select([
        "r.id as reservation_id",
        "r.reference_no",
        "r.created_at",
        "r.start_at",
        "r.end_at",
        "r.requestor_name",
        "r.site",
        "r.pickup_location",
        "r.dropoff_location",
        "r.ride_mode",
        "r.purpose",
        "r.details",
        "r.status",
        "r.assigned_driver_id",
        "r.assigned_van_id",
        "r.rental_driver_name",
        "r.rental_van_number",
        "r.rental_plate",
        "d.name as driver_name",
        "v.van_number as van_number",
        "v.plate as van_plate",
        "u.actor_name as updated_by_name",
        "u.created_at as updated_by_at",
      ])
      .select((eb) => [
        eb
          .exists(
            eb
              .selectFrom("reservation_events as e")
              .whereRef("e.reservation_id", "=", "r.id")
              .where("e.event_type", "=", "modified")
              .select("e.id"),
          )
          .as("has_modified"),
        eb
          .selectFrom("reservation_events as e")
          .whereRef("e.reservation_id", "=", "r.id")
          .where("e.event_type", "=", "driver_assigned")
          .select(({ fn }) => fn.min("e.created_at").as("v"))
          .as("first_assigned_at"),
      ])
      .orderBy("r.created_at", "desc")
  );
}

/**
 * The row's three-state source, from the two columns that can hold an
 * assignment. The roster id is checked first, but the two are mutually
 * exclusive by `reservations_{driver,van}_source_check`, so the order is
 * documentation rather than a tie-break.
 */
function sourceOf(
  rosterId: string | null,
  rentalKey: string | null,
): ReservationRow["driverSource"] {
  if (rosterId !== null) return "roster";
  return rentalKey !== null ? "rental" : null;
}

type ListRow = Awaited<
  ReturnType<ReturnType<typeof listQuery>["execute"]>
>[number];

function toRow(row: ListRow, audience: Audience): ReservationRow {
  const start = instantInManila(row.start_at);
  if (start === null) {
    throw new Error(`Reservation ${row.reference_no} has an invalid start_at`);
  }
  const end = row.end_at === null ? null : instantInManila(row.end_at);

  return {
    id: row.reference_no,
    submittedAt: row.created_at.toISOString(),
    startDate: start.date,
    startTime: start.time,
    endTime: end?.time ?? null,
    requestor: row.requestor_name,
    site: siteFromDb(row.site),
    from: row.pickup_location,
    // dropoff_location is NOT NULL for pickup by the mode-shape constraint;
    // the fallback exists only to satisfy the nullable column type.
    to: row.ride_mode === "standby" ? "Standby" : (row.dropoff_location ?? ""),
    mode: row.ride_mode as RideMode,
    purpose: row.purpose,
    details: row.details,
    /**
     * Mapped for a requestor, not for an admin. `Approved - Driver Reassigned`
     * is admin bookkeeping; the requestor's trip is still approved and they
     * learn about the new driver from the van-assignment email.
     *
     * Done HERE rather than in the API route because `/manage` is server
     * rendered and calls `listReservations` directly — a route-level mapping
     * would cover the API and leak on the page beside it.
     */
    status:
      audience === "admin"
        ? statusFromDb(row.status)
        : requestorFacingStatus(statusFromDb(row.status)),
    updatedBy: row.updated_by_name ?? null,
    updatedAt:
      row.updated_by_at === null ? null : row.updated_by_at.toISOString(),
    remarks: row.has_modified ? CHANGED_TRIP_DETAILS_REMARK : null,
    // A rental driver IS the driver: null here would make the calendar badge a
    // staffed trip "driver not assigned" and drop it out of the workload.
    driver: row.driver_name ?? row.rental_driver_name ?? null,
    driverId: row.assigned_driver_id,
    driverSource: sourceOf(row.assigned_driver_id, row.rental_driver_name),
    // Number first, plate as the fallback: a rental may have no fleet number,
    // and a blank cell would read as "no van assigned".
    vanLabel:
      row.van_number ?? row.rental_van_number ?? row.rental_plate ?? null,
    // rental_plate, not rental_van_number: the number is the nullable half of
    // the pair, the plate is what a rental van always has.
    vanSource: sourceOf(row.assigned_van_id, row.rental_plate),
    // Roster plate first: when a roster van is assigned, `van_plate` came in
    // via the join and `rental_plate` is null by the source-exclusivity
    // constraint. Falling back to `rental_plate` covers the rental case.
    vanPlate: row.van_plate ?? row.rental_plate ?? null,
    firstAssignedAt:
      row.first_assigned_at === null
        ? null
        : row.first_assigned_at.toISOString(),
  };
}

export async function listReservations(
  db: Kysely<DB>,
  scope: ReservationScope,
): Promise<ReservationRow[]> {
  let query = listQuery(db);
  if (!("all" in scope)) {
    query = query.where("r.requestor_user_id", "=", scope.requestorUserId);
  }
  const audience: Audience = "all" in scope ? "admin" : "requestor";
  const rows = await query.execute();
  return rows.map((row) => toRow(row, audience));
}

/**
 * The list projection plus the columns only the Trip Details drawer reads.
 * `van_plate` is not repeated here — `listQuery` already selects it for
 * `ReservationRow.vanPlate`, and selecting the same alias twice is a
 * duplicate column in the generated SQL for no benefit.
 */
function detailQuery(db: Kysely<DB>) {
  return listQuery(db).select([
    "r.requestor_user_id",
    "r.version",
    "r.requestor_email",
    "r.requestor_mobile",
    "r.approving_tower_head",
    "r.vendor",
    "r.cost_php",
    "r.rejection_reason",
    "r.rental_driver_mobile",
    "r.rental_car_type",
    "d.mobile as driver_mobile",
    "d.shift as driver_shift",
    "v.car_type as van_car_type",
  ]);
}

type DetailRow = Awaited<
  ReturnType<ReturnType<typeof detailQuery>["execute"]>
>[number];

/**
 * Keyed on the id, never on shift: shift is legitimately null for every Iloilo
 * driver, and guarding on it blanked the whole assignment. The id being
 * non-null is what proves the left join matched a row, so `name` and `mobile`
 * came with it — TS can't link sibling nullable columns from a left join,
 * hence the cast. The rental branch is exclusive with the roster one by the
 * `reservations_driver_source_check` constraint, and its mobile travels with
 * its name by `reservations_rental_driver_pair_check`.
 */
function driverOf(row: DetailRow): AssignedDriver | null {
  if (row.assigned_driver_id !== null) {
    return {
      source: "roster",
      id: row.assigned_driver_id,
      name: row.driver_name as string,
      mobile: row.driver_mobile as string,
      shift: row.driver_shift,
    };
  }
  if (row.rental_driver_name !== null) {
    return {
      source: "rental",
      name: row.rental_driver_name,
      mobile: row.rental_driver_mobile as string,
    };
  }
  return null;
}

/**
 * Same shape as `driverOf`. The rental branch keys on the plate, not the van
 * number: the number is the one rental field that may legitimately be absent,
 * while `rental_plate` and `rental_car_type` travel together by
 * `reservations_rental_van_pair_check`.
 */
function vanOf(row: DetailRow): AssignedVan | null {
  if (row.assigned_van_id !== null && row.van_number !== null) {
    return {
      source: "roster",
      id: row.assigned_van_id,
      vanNumber: row.van_number,
      plate: row.van_plate as string,
      carType: row.van_car_type as string,
    };
  }
  if (row.rental_plate !== null) {
    return {
      source: "rental",
      vanNumber: row.rental_van_number,
      plate: row.rental_plate,
      carType: row.rental_car_type as string,
    };
  }
  return null;
}

export async function getReservationDetail(
  db: Kysely<DB>,
  referenceNo: string,
): Promise<{ requestorUserId: string; detail: ReservationDetail } | null> {
  const row = await detailQuery(db)
    .where("r.reference_no", "=", referenceNo)
    .executeTakeFirst();

  if (row === undefined) return null;

  const passengers = await db
    .selectFrom("reservation_passengers")
    .select(["domain_id", "name"])
    .where("reservation_id", "=", row.reservation_id)
    .orderBy("position", "asc")
    .execute();

  // The detail's audience is decided by its route: this function hands back
  // `requestorUserId` for the ownership comparison, so it cannot know here
  // whether the caller owns the row.
  const base = toRow(row, "admin");
  const end = row.end_at === null ? null : instantInManila(row.end_at);

  const detail: ReservationDetail = {
    ...base,
    requestorEmail: row.requestor_email,
    requestorMobile: row.requestor_mobile,
    towerHead: row.approving_tower_head,
    passengers: passengers.map((p) => ({
      domainId: p.domain_id,
      name: p.name,
    })),
    pickupPoint: row.pickup_location,
    dropoffPoint: row.dropoff_location,
    endDate: end?.date ?? null,
    vendor: row.vendor,
    costPhp: row.cost_php,
    assignedDriver: driverOf(row),
    assignedVan: vanOf(row),
    rejectionReason: row.rejection_reason,
    version: row.version,
  };

  return { requestorUserId: row.requestor_user_id, detail };
}
