/**
 * The reservations domain vocabulary, as far as the requestor portal's landing
 * surface needs it. This is the seam the booking wizard and the manage table
 * will both consume, and the shape `/api/reservations` will speak — defined
 * here first so the UI is never the thing that invents the vocabulary.
 *
 * Deliberately does NOT yet declare a reservation row, a status, or a
 * passenger. Nothing on this surface renders one, and a type nothing consumes
 * is a guess that later code inherits as though it were a decision. They land
 * with the wizard and the manage table respectively.
 */

/**
 * The two things a requestor can book. `pickup` is one point-to-point trip at a
 * set time; `standby` holds a van and driver for a block of time and needs a
 * Tower Head to approve the cost.
 *
 * These strings are the wire format — they appear in `/book?mode=…` and will be
 * the column value in `reservations.ride_mode`, so they are lower-case and
 * stable. Every human-readable form goes through `RIDE_MODE_LABELS`.
 */
export const RIDE_MODES = ["pickup", "standby"] as const;
export type RideMode = (typeof RIDE_MODES)[number];

/**
 * Canonical display labels.
 *
 * The design document spells the pickup mode four different ways across its
 * surfaces — "Pickup / Drop-Off" on the ride card, "Pickup / Drop-off" in the
 * review summary, "Pickup/Drop Off" in the manage tab and the Van Type column,
 * and "Pickup / drop-off" in the hero metadata row. That is design drift, not
 * four meanings, so one spelling is canonical here and every surface reads it
 * from this map. `title` is the sentence-style form; `compact` is for the
 * metadata rule and table cells, where the string sits inline with others.
 */
export const RIDE_MODE_LABELS: Record<
  RideMode,
  { title: string; compact: string }
> = {
  pickup: { title: "Pickup / Drop-Off", compact: "Pickup / drop-off" },
  standby: { title: "Standby Van", compact: "Standby" },
};

/** Narrowing guard for values arriving from a URL or a form body. */
export function isRideMode(value: unknown): value is RideMode {
  return (
    typeof value === "string" &&
    (RIDE_MODES as readonly string[]).includes(value)
  );
}

/**
 * The two sites the service runs between. Site is a filter and a routing key
 * for notifications — never a permission boundary (Admin Support is one flat
 * role; see the spec's scope contract).
 */
export const SITE_LOCATIONS = ["Iloilo", "Manila"] as const;
export type SiteLocation = (typeof SITE_LOCATIONS)[number];

/**
 * Where a request sits in the approval flow.
 *
 * "Approved" is deliberate and is the project's agreed vocabulary — the Figma
 * status chart says "Assigned", and that word does not appear anywhere in this
 * system. See the spec's scope contract.
 *
 * `Approved - Driver Reassigned` records that an approved trip's van or driver
 * moved after the fact. It is admin bookkeeping only: `requestorFacingStatus`
 * collapses it back to `Approved` on every requestor-facing path.
 */
export const RESERVATION_STATUSES = [
  "Pending",
  "Approved",
  "Approved - Driver Reassigned",
  "Rejected",
  "Cancelled",
] as const;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

/**
 * Statuses that hold a van and a driver's time.
 *
 * Exported because `calendar.ts` and `drivers/workload.ts` each spelled this as
 * a local `new Set(["Pending", "Approved"])` — a set that silently stops being
 * right every time a status is added. Under those literals a reassigned trip
 * vanished from the schedule and dropped out of its driver's weekly total: a van
 * and a driver committed to a trip the calendar no longer showed.
 */
export const SCHEDULED_STATUSES: ReadonlySet<ReservationStatus> = new Set([
  "Pending",
  "Approved",
  "Approved - Driver Reassigned",
]);

/** Approved in substance, whichever of the two spellings the row carries. */
export const APPROVED_STATUSES: ReadonlySet<ReservationStatus> = new Set([
  "Approved",
  "Approved - Driver Reassigned",
]);

/** A requestor may still change a request only while it is awaiting approval. */
export function isRequestorEditable(status: ReservationStatus): boolean {
  return status === "Pending";
}

/**
 * Cancellation reaches further than editing: a requestor whose approved trip is
 * called off must be able to withdraw it, and so must an admin acting for them.
 * Rejected and Cancelled stay terminal.
 *
 * Derived from `SCHEDULED_STATUSES` rather than restating `Pending || Approved`
 * — the same set today, and it cannot drift from the calendar's idea of a live
 * trip tomorrow.
 */
export function isCancellable(status: ReservationStatus): boolean {
  return SCHEDULED_STATUSES.has(status);
}

/**
 * An admin may move the driver or the van on an approved trip.
 *
 * Deliberately NOT `isRequestorEditable`: that predicate gates trip-field edits
 * and admin decisions, both of which still require a pending row.
 */
export function isReassignable(status: ReservationStatus): boolean {
  return APPROVED_STATUSES.has(status);
}

/**
 * What the REQUESTOR is told.
 *
 * `Approved - Driver Reassigned` is admin bookkeeping: the trip is still
 * approved, and a requestor reading "Driver Reassigned" on their own booking has
 * no way to tell whether something went wrong. They learn about the change from
 * the van-assignment email, which carries the new driver's name and number.
 */
export function requestorFacingStatus(
  status: ReservationStatus,
): ReservationStatus {
  return status === "Approved - Driver Reassigned" ? "Approved" : status;
}

/**
 * One row of the requestor's bookings list — the shape `GET /api/reservations`
 * will return.
 *
 * `submittedAt` is an instant (a `timestamptz`); `startDate` is a plain calendar
 * date. They are deliberately different types, because rendering the second one
 * through a timezone is how a booking shows the wrong day. See `lib/tz.ts`.
 *
 * There is no `upcoming` flag. The design document stores one, which is stale
 * the moment the clock passes the trip's date — it is derived from `startDate`
 * against today in Manila instead.
 */
export interface ReservationRow {
  /** Human-facing reference — the row's `reference_no`, e.g. "VR-2026-000412". */
  id: string;
  submittedAt: string;
  startDate: string;
  /**
   * Wall-clock start, `"HH:mm"`. Plain, not an instant — see `startDate` above
   * and `lib/tz.ts`.
   *
   * The database column is a `timestamptz`, so the API converts to Manila
   * wall-clock at its boundary rather than shipping an instant the client has to
   * re-zone. A van schedule IS a wall-clock commitment: an 06:30 pickup is 06:30
   * to the driver and the passenger, and rendering it through the browser's zone
   * is how the admin calendar would place a trip in the wrong 30-minute row.
   */
  startTime: string;
  /** Standby only — the block's end. Null for a point-to-point pickup. */
  endTime: string | null;
  requestor: string;
  site: SiteLocation;
  /** Free-text pickup point, or "Standby" for a standby booking's destination. */
  from: string;
  to: string;
  mode: RideMode;
  /**
   * Normally one of `TRIP_PURPOSES`, enforced by `isTripPurpose` at the write
   * path — but there is no database CHECK, so a row written before the
   * vocabulary consolidation can still hold an off-list value. Typed as
   * `string`, not `TripPurpose`, for exactly that reason.
   */
  purpose: string;
  /** The requestor's paragraph describing the trip. */
  details: string;
  status: ReservationStatus;
  /** Who last acted on it — admin or requestor; null while untouched. */
  updatedBy: string | null;
  /**
   * ISO instant of the most recent action on this request, by anyone, or null
   * when nothing has happened to it since submission.
   *
   * Pairs with `updatedBy`, which names the actor of the SAME event — both come
   * from one lateral join precisely so they cannot disagree.
   */
  updatedAt: string | null;
  /**
   * The driver's name, roster or rental, or null while none is assigned.
   *
   * On the list rather than only on the detail because two views need it
   * without opening a request: the calendar badges an unassigned trip, and the
   * driver workload sums each driver's week. Deriving either from `status ===
   * "Approved"` works only because a database constraint currently forces the
   * two to agree — reading the actual field means those views stay correct if
   * that ever changes.
   *
   * A rental driver resolves here too: a rental IS the driver, and leaving this
   * null would make the calendar badge a staffed trip "driver not assigned"
   * and drop it out of the workload totals.
   */
  driver: string | null;
  /**
   * The roster driver's id, or null.
   *
   * Null for a rental as much as for an unassigned trip: a rental driver has no
   * roster row to point at. `driverSource` is the field that tells those two
   * apart — never read "unassigned" out of this one alone.
   *
   * On the row because grouping by name mis-merges the second Villanueva, and
   * the workload screen groups thousands of rows without fetching a detail.
   */
  driverId: string | null;
  /**
   * Where the driver came from: `"roster"`, `"rental"`, or null when nobody is
   * assigned.
   *
   * Three states rather than a boolean beside a nullable id, because "no id"
   * means both "unassigned" and "rental" — every screen that checked
   * `driverId === null` would render a staffed rental as driverless. The
   * illegal reading is unrepresentable here instead of merely documented.
   */
  driverSource: "roster" | "rental" | null;
  /**
   * How to name the van in one cell: the roster van's number, else the rental's
   * number, else the rental's plate. Null exactly when no van is assigned.
   *
   * The plate fallback matters because a rental may genuinely have no fleet
   * number, and a blank cell reads as "no van assigned" rather than "a van
   * whose number we don't know".
   */
  vanLabel: string | null;
  /**
   * Where the van came from: `"roster"`, `"rental"`, or null when none is
   * assigned — the same three states as `driverSource`.
   *
   * `vanLabel` cannot answer this: a vendor may hand over a van numbered
   * exactly like a fleet one, and the plate fallback makes a rental's label
   * indistinguishable from a fleet number by shape.
   */
  vanSource: "roster" | "rental" | null;
  /**
   * The physical vehicle's plate — the roster van's `plate` when a roster van
   * is assigned, the rental's `rental_plate` when a rental is, null when none
   * is assigned.
   *
   * Separate from `vanLabel`: that field is the fleet's own numbering (or a
   * rental's stand-in for it), which is what most screens want to identify a
   * van by. This one is the actual plate on the vehicle — the client asked to
   * see it specifically, and for a roster van it is never the same string as
   * `vanLabel`.
   */
  vanPlate: string | null;
  /**
   * What has happened to this request since it was submitted, e.g. "Changed
   * Trip Details" — the flag a reviewer needs before approving something the
   * requestor edited after sending.
   *
   * Derived, not stored: the spec's `reservation_events` table already records a
   * `modified` event, so this is that timeline summarised for the list rather
   * than a second copy of the same fact that can fall out of step with it. Null
   * when nothing has happened.
   */
  remarks: string | null;
  /**
   * Instant the admin FIRST assigned a driver and sent the confirmation — the
   * basis for turnaround time (TAT = this minus `submittedAt`) and the SLA
   * metric (within SLA when TAT ≤ 12h). The FIRST assignment counts even if the
   * driver is later reassigned. Null/absent until a request has been assigned,
   * so only assigned requests contribute to TAT/SLA.
   *
   * Optional because only the analytics dashboard consumes it; every other
   * surface ignores it, so existing row constructors need not supply it. The
   * real `/api/reservations` includes it (possibly null) from
   * `reservation_events`' first `assigned` event.
   */
  firstAssignedAt?: string | null;
}

/** One named seat on a booking, as the wizard's passenger rows collect them. */
export interface PassengerRef {
  domainId: string;
  name: string;
}

/**
 * Who is driving a trip: someone on the roster, or a one-off hired in for it.
 *
 * `source` is part of the type on purpose. It forces every screen to decide how
 * it renders a rental rather than discovering the case at runtime — a rental
 * driver has no roster row, so no id and no shift, and a screen that assumed
 * those were always there would render blanks instead of failing to compile.
 */
export type AssignedDriver =
  | {
      source: "roster";
      id: string;
      name: string;
      mobile: string;
      shift: string | null;
    }
  | { source: "rental"; name: string; mobile: string };

/**
 * Which van is running a trip: one from the fleet, or a rental.
 *
 * `source` is part of the type for the same reason as `AssignedDriver`'s — a
 * rental van has no fleet row, so no id, and its van number is whatever the
 * vendor gave (often nothing). Every screen has to handle that explicitly.
 */
export type AssignedVan =
  | {
      source: "roster";
      id: string;
      vanNumber: string;
      plate: string;
      carType: string;
    }
  | {
      source: "rental";
      vanNumber: string | null;
      plate: string;
      carType: string;
    };

/**
 * The same two concepts as `AssignedDriver` / `AssignedVan`, as an admin's save
 * SENDS them — deliberately beside the read shapes: one pair is what the client
 * writes, the other what the server returns.
 *
 * A rental carries no id because it has no roster row: it is a per-trip fact
 * typed in by hand, and `reservations_driver_source_check` /
 * `reservations_van_source_check` keep the two columns mutually exclusive.
 *
 * They live here rather than in `write.ts` so `write.ts`, `decision.ts` and
 * `wire.ts` can all reach them without importing each other — `decision.ts`
 * taking them from `write.ts` was a cycle that survived only because the import
 * was type-erased.
 */
export type DriverInput =
  | { source: "roster"; driverId: string }
  | { source: "rental"; name: string; mobile: string };

export type VanInput =
  | { source: "roster"; vanId: string }
  | {
      source: "rental";
      /** The one optional rental field: a vendor often gives no unit number. */
      vanNumber: string | null;
      plate: string;
      carType: string;
    };

/**
 * Everything the admin's Trip Details drawer shows — one row plus the fields
 * that only matter when a request is being reviewed. The shape
 * `GET /api/reservations/[id]` will return.
 *
 * Split from `ReservationRow` rather than folded into it because the master
 * list renders hundreds of rows and needs none of this; sending it with every
 * row would make the list payload a multiple of its useful size.
 *
 * Two fields the design's drawer shows are deliberately absent: "# of Vans" and
 * "Will this incur additional cost?". The booking wizard collects neither, and
 * no table in the spec's data model holds them — an input bound to nothing
 * would silently discard whatever an admin typed into it. The costing section
 * already answers the cost question with real values.
 */
export interface ReservationDetail extends ReservationRow {
  requestorEmail: string;
  requestorMobile: string;
  /** Standby only — the Tower Head the cost is charged to. */
  towerHead: string | null;
  passengers: PassengerRef[];
  /** Where the van collects (pickup) or waits (standby). */
  pickupPoint: string;
  /** Pickup only. */
  dropoffPoint: string | null;
  /** Standby only; a block may cross midnight. */
  endDate: string | null;
  /** Admin-owned, either mode — the van hire is booked against a vendor. */
  vendor: string | null;
  /**
   * Admin-owned, either mode. Whole pesos. A number, not a pre-formatted
   * string, so it can be summed.
   */
  costPhp: number | null;
  /**
   * Who is driving, roster or rental — null until Admin Support assigns.
   *
   * NOT called `driver`: the row already has one, and it is the driver's NAME,
   * which the master list, calendar and workload read without fetching a
   * detail. Since `ReservationDetail` extends `ReservationRow`, one name for
   * two shapes across that subtype relationship is a bug waiting to happen —
   * someone reads `row.driver` and gets a string, then `detail.driver` and
   * gets an object.
   *
   * Carries the roster driver's id, which the drawer's select preselects and
   * `PATCH` carries back. Matching the roster on the name in `driver` instead
   * would silently mis-assign the second Villanueva.
   */
  assignedDriver: AssignedDriver | null;
  /** Which van is running it, fleet or rental — null until assigned. */
  assignedVan: AssignedVan | null;
  /** Required by the spec's schema whenever status is Rejected. */
  rejectionReason: string | null;
  /**
   * The row's optimistic-concurrency token, sent back with a decision.
   *
   * On the detail and not the row because only the drawer writes: `PATCH
   * /api/reservations/[id]` applies its update only against the version the
   * caller read, so the second of two admins reviewing one request is refused
   * rather than silently overwriting the first. A client that cannot read the
   * token cannot satisfy that check, which is why it travels on the same
   * payload the drawer already fetches.
   */
  version: number;
}

/**
 * The one remark the list surfaces today: derived by the repo from the
 * presence of a `modified` event, never stored as a column (see
 * `ReservationRow.remarks` above).
 */
export const CHANGED_TRIP_DETAILS_REMARK = "Changed Trip Details";
