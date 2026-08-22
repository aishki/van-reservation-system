import type { Transaction } from "kysely";
import {
  EM_DASH,
  formatPlainDate,
  formatPlainDateTime,
  formatPlainTime,
  instantInManila,
} from "@/lib/tz";
import type { DB } from "@/modules/db/types";
import type {
  RequestDriver,
  RequestInformationInput,
  RequestTrip,
} from "@/modules/email/templates/request-information";
import { siteFromDb } from "@/modules/reservations/db-map";
import {
  type BookingDraft,
  normalizeMobile,
} from "@/modules/reservations/draft";
import { RIDE_MODE_LABELS, type RideMode } from "@/modules/reservations/types";

/**
 * Recording a notification, inside the transaction that owes it.
 *
 * ── One spine, two channels ──────────────────────────────────────────────────
 * In-app notifications and emails fire on the SAME six transitions. Recording
 * them as two independent mechanisms would mean two sets of triggers in
 * `write.ts`, drifting apart the first time an event is added — so ONE
 * `notification_events` row is written per event and the channels fan out from
 * it: `recipientUserId` is the in-app channel, `emails` is the email channel.
 *
 * ── Why in the transaction ───────────────────────────────────────────────────
 * The rows commit or roll back with the reservation, atomically. An `await` on
 * SES here instead would mean a provider timeout rolls back a booking someone
 * spent four wizard steps filling in; moving the send after the commit trades
 * that for losing the mail with no record it was owed. Delivery is a separate,
 * retryable step (`email/dispatch.ts`) whose failure is visible on the row.
 */

/** The six transitions a requestor is notified about. Mirrors the table's CHECK. */
export type NotificationEvent =
  | "submitted"
  | "approved"
  | "rejected"
  | "cancelled"
  | "driver_assigned"
  | "driver_changed";

export type NotificationTemplate =
  | "booking-submitted"
  | "admin-new-request"
  // Approved / Rejected / Cancelled share one template; the status is a payload
  // field, not a template name.
  | "booking-status-change"
  // A driver change is NOT a status change — the reservation stays Approved.
  | "driver-assignment";

/** One outbound message. An event may owe several (the requestor and the admins). */
export interface EmailChannel {
  template: NotificationTemplate;
  /** One address, or several comma-joined — the dispatcher splits them. */
  recipient: string;
  cc?: string[];
  /** The template's input, already formatted. Stored as jsonb. */
  payload: unknown;
}

export interface NotificationRecord {
  /** Null for the submitted digest: it is about a submission, not one row. */
  reservationId: string | null;
  event: NotificationEvent;
  /**
   * The event always describes itself, even when it has no in-app recipient —
   * an email-only notice is still worth reading back when auditing what the
   * system said. These three are what the bell renders when there IS one.
   */
  title: string;
  body: string;
  /** Where clicking lands, e.g. `/manage?ref=VR-1042`. */
  link: string;
  /** The in-app channel. Absent for a notice that only goes to addresses. */
  recipientUserId?: string;
  /** The email channel. Absent, or empty, for an in-app-only notice. */
  emails?: EmailChannel[];
}

/** Returns the event's id, so a caller (or a test) can tie messages back to it. */
export async function recordNotification(
  trx: Transaction<DB>,
  record: NotificationRecord,
): Promise<string> {
  const event = await trx
    .insertInto("notification_events")
    .values({
      reservation_id: record.reservationId,
      event: record.event,
      recipient_user_id: record.recipientUserId ?? null,
      title: record.title,
      body: record.body,
      link: record.link,
    })
    .returning("id")
    .executeTakeFirstOrThrow();

  for (const email of record.emails ?? []) {
    // A message with nobody to send it to is skipped, not queued. Writing it
    // would manufacture a permanent VALIDATION_FAILED and train whoever reads
    // the failure log to ignore it. Happens when a site has no notifiable
    // admin — the EVENT still stands, only this channel is empty.
    if (email.recipient.trim() === "") continue;

    await trx
      .insertInto("notification_outbox")
      .values({
        event_id: event.id,
        template: email.template,
        recipient: email.recipient.trim(),
        cc: JSON.stringify(email.cc ?? []),
        payload: JSON.stringify(email.payload),
      })
      .execute();
  }

  return event.id;
}

/**
 * A submission's draft → the template input, for `submitBooking`.
 *
 * The draft is already in hand there, so nothing is re-read. `references` is the
 * array `submitBooking` builds as it inserts, one per trip in the same order —
 * the positional pairing below relies on that order and on nothing else.
 *
 * Every date and time is formatted HERE, once, through `lib/tz`. The templates
 * lay out strings and never see a `Date`: an email has no timezone, and a value
 * rendered in the wrong one shows the wrong day. `tz.test.ts`'s drift guard
 * enforces the half of that which can be enforced.
 *
 * Empty values become `EM_DASH` rather than `""`. A blank string would render as
 * a label with nothing under it, and `sendEmail` fails a message whose body is
 * empty — so a missing field degrades to a dash instead of burning the row.
 */
export function requestInformationFromDraft(
  draft: BookingDraft,
  references: string[],
  requestor: { name: string; email: string },
): RequestInformationInput {
  return {
    site: draft.site || EM_DASH,
    rideMode: RIDE_MODE_LABELS[draft.mode].title,
    requestor: {
      name: requestor.name,
      email: requestor.email,
      mobile: normalizeMobile(draft.mobile) || EM_DASH,
    },
    trips: draft.trips.map((trip, index) => {
      const referenceId = references[index] ?? EM_DASH;
      const passengers = trip.passengers.map((passenger) => ({
        name: passenger.name || EM_DASH,
        domainId: passenger.domainId || EM_DASH,
      }));

      if (draft.mode === "standby") {
        const from = formatPlainDate(trip.startDate) ?? EM_DASH;
        const to = formatPlainDate(trip.endDate) ?? EM_DASH;
        const start = formatPlainTime(trip.startTime) ?? EM_DASH;
        const end = formatPlainTime(trip.endTime) ?? EM_DASH;
        return {
          mode: "standby",
          referenceId,
          purpose: trip.purpose || EM_DASH,
          details: trip.details || EM_DASH,
          towerHead: trip.towerHead || EM_DASH,
          window: `${from} → ${to}`,
          hours: `${start} – ${end}`,
          reportingPoint: trip.pickupPoint || EM_DASH,
          passengers,
        } satisfies RequestTrip;
      }

      return {
        mode: "pickup",
        referenceId,
        purpose: trip.purpose || EM_DASH,
        details: trip.details || EM_DASH,
        pickup:
          formatPlainDateTime(trip.pickupDate, trip.pickupTime) ?? EM_DASH,
        pickupPoint: trip.pickupPoint || EM_DASH,
        dropoffPoint: trip.dropoffPoint || EM_DASH,
        passengers,
      } satisfies RequestTrip;
    }),
  };
}

/**
 * A stored reservation → the template input, for `decideReservation` and
 * `cancelReservation`, which hold a row rather than a draft.
 *
 * One reservation is one trip, so `trips` always has exactly one card.
 *
 * `start_at` and `end_at` are `timestamptz`. They go through `instantInManila`
 * BEFORE formatting, because the card shows a calendar date and an instant
 * formatted in the wrong zone reads as the previous day for eight hours out of
 * every twenty-four. This is the single most load-bearing line in the file.
 */
export async function loadRequestInformation(
  trx: Transaction<DB>,
  reservationId: string,
): Promise<RequestInformationInput> {
  const row = await trx
    .selectFrom("reservations as r")
    // Left joins, because either side of the assignment may be a rental (no
    // roster row at all) or not yet assigned.
    .leftJoin("drivers as d", "d.id", "r.assigned_driver_id")
    .leftJoin("vans as v", "v.id", "r.assigned_van_id")
    .select([
      "r.reference_no",
      "r.ride_mode",
      "r.site",
      "r.requestor_name",
      "r.requestor_email",
      "r.requestor_mobile",
      "r.purpose",
      "r.details",
      "r.start_at",
      "r.end_at",
      "r.pickup_location",
      "r.dropoff_location",
      "r.approving_tower_head",
      "d.name as roster_driver_name",
      "d.mobile as roster_driver_mobile",
      "v.plate as roster_plate",
      "v.car_type as roster_car_type",
      "r.rental_driver_name",
      "r.rental_driver_mobile",
      "r.rental_plate",
      "r.rental_car_type",
    ])
    .where("r.id", "=", reservationId)
    .executeTakeFirstOrThrow();

  const passengerRows = await trx
    .selectFrom("reservation_passengers")
    .select(["domain_id", "name"])
    // The order the requestor entered them, so the mail reads like the form.
    .orderBy("position")
    .where("reservation_id", "=", reservationId)
    .execute();

  const passengers = passengerRows.map((passenger) => ({
    name: passenger.name,
    domainId: passenger.domain_id,
  }));

  const driver = assignedVanOf(row);
  const mode = row.ride_mode as RideMode;
  const start = instantInManila(row.start_at);
  const end = row.end_at === null ? null : instantInManila(row.end_at);

  const trip: RequestTrip =
    mode === "standby"
      ? {
          mode: "standby",
          referenceId: row.reference_no,
          purpose: row.purpose,
          details: row.details,
          towerHead: row.approving_tower_head ?? EM_DASH,
          window: `${formatPlainDate(start?.date) ?? EM_DASH} → ${
            formatPlainDate(end?.date) ?? EM_DASH
          }`,
          hours: `${formatPlainTime(start?.time) ?? EM_DASH} – ${
            formatPlainTime(end?.time) ?? EM_DASH
          }`,
          reportingPoint: row.pickup_location,
          passengers,
          driver,
        }
      : {
          mode: "pickup",
          referenceId: row.reference_no,
          purpose: row.purpose,
          details: row.details,
          pickup: formatPlainDateTime(start?.date, start?.time) ?? EM_DASH,
          pickupPoint: row.pickup_location,
          // `reservations_mode_shape_check` guarantees this is non-null on a
          // pickup row, so the fallback is a concession to the nullable column
          // rather than a case that renders. See `notify.int.test.ts`.
          dropoffPoint: row.dropoff_location ?? EM_DASH,
          passengers,
          driver,
        };

  return {
    site: siteFromDb(row.site),
    rideMode: RIDE_MODE_LABELS[mode].title,
    requestor: {
      name: row.requestor_name,
      email: row.requestor_email,
      mobile: row.requestor_mobile,
    },
    trips: [trip],
  };
}

/**
 * The "Assigned van" block: who is driving and which unit, from whichever side
 * holds it — the roster row or the typed-in rental.
 *
 * Rental status is deliberately NOT disclosed. The requestor is told the plate
 * and a mobile so they can meet their van; who owns it is Admin Support's
 * business, and the same block serves both cases.
 *
 * `undefined` — omitting the block entirely — only when NEITHER side is
 * assigned. One side without the other dashes the missing half rather than
 * hiding the half that exists; a blank string would fail the template's
 * `min(1)` payload check and burn the outbox row.
 *
 * Returns `RequestDriver` — a legacy name from before the fleet split, reused
 * here on purpose rather than renamed, for a value that names a van.
 */
function assignedVanOf(row: {
  roster_driver_name: string | null;
  roster_driver_mobile: string | null;
  roster_plate: string | null;
  roster_car_type: string | null;
  rental_driver_name: string | null;
  rental_driver_mobile: string | null;
  rental_plate: string | null;
  rental_car_type: string | null;
}): RequestDriver | undefined {
  const name = row.roster_driver_name ?? row.rental_driver_name;
  const mobile = row.roster_driver_mobile ?? row.rental_driver_mobile;
  const plate = row.roster_plate ?? row.rental_plate;
  const carType = row.roster_car_type ?? row.rental_car_type;
  if (name === null && plate === null) return undefined;
  return {
    name: name ?? EM_DASH,
    mobile: mobile ?? EM_DASH,
    plate: plate ?? EM_DASH,
    carType: carType ?? EM_DASH,
  };
}
