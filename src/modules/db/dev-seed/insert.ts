import type { Kysely } from "kysely";
import { instantFromManila } from "@/lib/tz";
import { personByDisplayName } from "@/modules/db/dev-seed/people";
import type { DB } from "@/modules/db/types";
import { SITE_TO_DB, STATUS_TO_DB } from "@/modules/reservations/db-map";
import type {
  ReservationStatus,
  RideMode,
  SiteLocation,
} from "@/modules/reservations/types";

/**
 * One reservation as the seed describes it — wall-clock values and display
 * names, converted to instants and foreign keys at insert time. Both the
 * canonical 8 and the generated year produce this shape.
 */
export interface ReservationSpec {
  /** Provenance note (e.g. "REQ-1051" or "DSH-2041") — comments only, never stored. */
  key: string;
  mode: RideMode;
  status: ReservationStatus;
  site: SiteLocation;
  /** ISO instant of submission — becomes created_at and the submitted event. */
  submittedAt: string;
  /** Manila wall-clock schedule. */
  startDate: string;
  startTime: string;
  endDate: string | null;
  endTime: string | null;
  /** displayName of a SEED_PEOPLE requestor. */
  requestor: string;
  requestorMobile: string;
  purpose: string;
  details: string;
  pickupLocation: string;
  dropoffLocation: string | null;
  towerHead: string | null;
  vendor: string | null;
  costPhp: number | null;
  passengers: { domainId: string; name: string }[];
  /** Driver NAME from SEED_DRIVERS, or null. */
  driver: string | null;
  /** Van NUMBER from SEED_VANS, or null. */
  van: string | null;
  /** displayName of the admin who decided, or null while pending. */
  actedBy: string | null;
  /** ISO instant of the admin action (assignment/decision). */
  actedAt: string | null;
  /** Whether the requestor edited after submitting (drives the modified event). */
  modified: boolean;
  rejectionReason: string | null;
  cancellationReason: string | null;
}

export interface SeedContext {
  /** domain_id → users.id, filled by the people upsert. */
  userIds: Map<string, string>;
  /** driver name → drivers.id, filled by the driver insert. */
  driverIds: Map<string, string>;
  /** van number → vans.id, filled by the van insert. */
  vanIds: Map<string, string>;
}

function requireInstant(date: string, time: string, key: string): Date {
  const instant = instantFromManila(date, time);
  if (instant === null) {
    throw new Error(`Seed row ${key} has an invalid schedule: ${date} ${time}`);
  }
  return instant;
}

export async function insertReservation(
  db: Kysely<DB>,
  ctx: SeedContext,
  spec: ReservationSpec,
  referenceNo: string,
): Promise<void> {
  const requestor = personByDisplayName(spec.requestor);
  const requestorUserId = ctx.userIds.get(requestor.domainId);
  if (requestorUserId === undefined) {
    throw new Error(
      `Seed row ${spec.key}: requestor ${spec.requestor} was not seeded`,
    );
  }

  const driverId = spec.driver === null ? null : ctx.driverIds.get(spec.driver);
  if (spec.driver !== null && driverId === undefined) {
    throw new Error(
      `Seed row ${spec.key}: driver ${spec.driver} was not seeded`,
    );
  }

  const vanId = spec.van === null ? null : ctx.vanIds.get(spec.van);
  if (spec.van !== null && vanId === undefined) {
    throw new Error(`Seed row ${spec.key}: van ${spec.van} was not seeded`);
  }

  const submitted = new Date(spec.submittedAt);
  const acted = spec.actedAt === null ? null : new Date(spec.actedAt);

  const reservation = await db
    .insertInto("reservations")
    .values({
      reference_no: referenceNo,
      ride_mode: spec.mode,
      status: STATUS_TO_DB[spec.status],
      site: SITE_TO_DB[spec.site],
      requestor_user_id: requestorUserId,
      requestor_name: spec.requestor,
      requestor_email: requestor.email,
      requestor_mobile: spec.requestorMobile,
      purpose: spec.purpose,
      details: spec.details,
      start_at: requireInstant(spec.startDate, spec.startTime, spec.key),
      end_at:
        spec.endDate === null || spec.endTime === null
          ? null
          : requireInstant(spec.endDate, spec.endTime, spec.key),
      pickup_location: spec.pickupLocation,
      dropoff_location: spec.dropoffLocation,
      approving_tower_head: spec.towerHead,
      vendor: spec.vendor,
      cost_php: spec.costPhp,
      assigned_driver_id: driverId ?? null,
      assigned_van_id: vanId ?? null,
      rejection_reason: spec.rejectionReason,
      cancellation_reason: spec.cancellationReason,
      cancelled_by_role:
        spec.cancellationReason === null ? null : "admin_support",
      created_at: submitted,
      updated_at: acted ?? submitted,
    })
    .returning("id")
    .executeTakeFirstOrThrow();

  if (spec.passengers.length > 0) {
    await db
      .insertInto("reservation_passengers")
      .values(
        spec.passengers.map((passenger, index) => ({
          reservation_id: reservation.id,
          domain_id: passenger.domainId,
          name: passenger.name,
          position: index + 1,
        })),
      )
      .execute();
  }

  type EventValues = {
    reservation_id: string;
    actor_user_id: string | null;
    actor_name: string | null;
    actor_role: string | null;
    event_type: string;
    remark: string | null;
    created_at: Date;
  };

  const events: EventValues[] = [
    {
      reservation_id: reservation.id,
      actor_user_id: requestorUserId,
      actor_name: spec.requestor,
      actor_role: "associate",
      event_type: "submitted",
      remark: null,
      created_at: submitted,
    },
  ];

  if (spec.modified) {
    events.push({
      reservation_id: reservation.id,
      actor_user_id: requestorUserId,
      actor_name: spec.requestor,
      actor_role: "associate",
      event_type: "modified",
      remark: null,
      // Two hours after submission: deterministic, and safely before any
      // admin action in every canonical and generated row.
      created_at: new Date(submitted.getTime() + 2 * 3_600_000),
    });
  }

  if (spec.actedBy !== null && acted !== null) {
    const admin = personByDisplayName(spec.actedBy);
    const adminUserId = ctx.userIds.get(admin.domainId);
    if (adminUserId === undefined) {
      throw new Error(
        `Seed row ${spec.key}: admin ${spec.actedBy} was not seeded`,
      );
    }
    const adminEvent = (
      event_type: string,
      remark: string | null,
    ): EventValues => ({
      reservation_id: reservation.id,
      actor_user_id: adminUserId,
      actor_name: spec.actedBy as string,
      actor_role: "admin_support",
      event_type,
      remark,
      created_at: acted,
    });

    if (spec.status === "Approved") {
      events.push(
        adminEvent("driver_assigned", null),
        adminEvent("approved", null),
      );
    } else if (spec.status === "Rejected") {
      events.push(adminEvent("rejected", spec.rejectionReason));
    } else if (spec.status === "Cancelled") {
      events.push(adminEvent("cancelled", spec.cancellationReason));
    }
  }

  await db.insertInto("reservation_events").values(events).execute();
}
