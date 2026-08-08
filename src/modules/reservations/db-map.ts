/**
 * The wire ↔ database vocabulary boundary. The database stores lower-case
 * values (consistent with users.role and admin_whitelist.site); the wire
 * types speak the UI's title-case strings. This file is the ONLY place the
 * two vocabularies meet — schema-constraints.int.test.ts pins the DB side
 * against the live CHECK constraints.
 *
 * `ride_mode` has no map: RIDE_MODES ("pickup" | "standby") is already the
 * column vocabulary, by the contract documented in types.ts.
 */
import type {
  ReservationStatus,
  SiteLocation,
} from "@/modules/reservations/types";

export const STATUS_TO_DB = {
  Pending: "pending",
  Approved: "approved",
  "Approved - Driver Reassigned": "approved_reassigned",
  Rejected: "rejected",
  Cancelled: "cancelled",
} as const satisfies Record<ReservationStatus, string>;

export type DbReservationStatus =
  (typeof STATUS_TO_DB)[keyof typeof STATUS_TO_DB];

export const DB_RESERVATION_STATUSES = Object.values(
  STATUS_TO_DB,
) as readonly DbReservationStatus[];

const STATUS_FROM_DB = Object.fromEntries(
  Object.entries(STATUS_TO_DB).map(([wire, db]) => [db, wire]),
) as Record<DbReservationStatus, ReservationStatus>;

export function statusFromDb(value: string): ReservationStatus {
  const status = STATUS_FROM_DB[value as DbReservationStatus];
  if (status === undefined) {
    throw new Error(`Unknown reservation status in database: "${value}"`);
  }
  return status;
}

export const SITE_TO_DB = {
  Iloilo: "iloilo",
  Manila: "manila",
} as const satisfies Record<SiteLocation, string>;

export type DbSiteLocation = (typeof SITE_TO_DB)[keyof typeof SITE_TO_DB];

export const DB_SITE_LOCATIONS = Object.values(
  SITE_TO_DB,
) as readonly DbSiteLocation[];

const SITE_FROM_DB = Object.fromEntries(
  Object.entries(SITE_TO_DB).map(([wire, db]) => [db, wire]),
) as Record<DbSiteLocation, SiteLocation>;

export function siteFromDb(value: string): SiteLocation {
  const site = SITE_FROM_DB[value as DbSiteLocation];
  if (site === undefined) {
    throw new Error(`Unknown site in database: "${value}"`);
  }
  return site;
}

/** The append-only audit vocabulary — the write slice adds writers, not values. */
export const RESERVATION_EVENT_TYPES = [
  "submitted",
  "approved",
  "rejected",
  "cancelled",
  "modified",
  "driver_assigned",
  "driver_reassigned",
  "van_assigned",
  "van_reassigned",
] as const;

export type ReservationEventType = (typeof RESERVATION_EVENT_TYPES)[number];
