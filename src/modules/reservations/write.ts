import type { Insertable, Kysely, Transaction, Updateable } from "kysely";
import type { ErrorCode } from "@/lib/api-error";
import { env } from "@/lib/env";
import { err, ok, type Result } from "@/lib/result";
import {
  formatPlainDateTime,
  instantFromManila,
  instantInManila,
} from "@/lib/tz";
import type { FieldChange } from "@/modules/audit/types";
import type { AppRole } from "@/modules/auth/roles";
import type { DB, ReservationEvents, Reservations } from "@/modules/db/types";
import { adminRecipients } from "@/modules/email/recipients";
import {
  SITE_TO_DB,
  STATUS_TO_DB,
  siteFromDb,
  statusFromDb,
} from "@/modules/reservations/db-map";
import {
  type Decision,
  isDecisionValid,
  validateDecisionInput,
} from "@/modules/reservations/decision";
import {
  type BookingDraft,
  isDraftStepValid,
  normalizeMobile,
  type TripDraft,
  validateStep,
} from "@/modules/reservations/draft";
import {
  loadRequestInformation,
  recordNotification,
  requestInformationFromDraft,
} from "@/modules/reservations/notify";
import { isTripPurpose } from "@/modules/reservations/reference";
import { nextReferenceNo } from "@/modules/reservations/reference-no";
import {
  type DriverInput,
  isCancellable,
  isReassignable,
  isRequestorEditable,
  type ReservationStatus,
  type RideMode,
  type VanInput,
} from "@/modules/reservations/types";

/**
 * Everything that writes a reservation.
 *
 * Split from `repo.ts`, which only reads, because these functions carry rules
 * the read path has no use for: who may act, which transitions are legal, and
 * the audit row each write owes `reservation_events`. Every one of them runs in
 * a transaction, so a reservation cannot exist without the `submitted` event
 * that explains it, and a decision cannot land without its own.
 *
 * None of them read the session. The caller — a route handler — resolves the
 * actor and passes it in, the same arrangement `ReservationScope` uses on the
 * read side: this module trusts its actor and never widens it.
 */

/** The signed-in user, as a writer. A subset of `SessionUser` by design. */
export interface WriteActor {
  userId: string;
  name: string;
  email: string;
  /**
   * Doubles as the `actor_role` / `cancelled_by_role` column value: `AppRole`
   * and the two CHECK constraints share one vocabulary, so unlike status and
   * site there is nothing here for `db-map.ts` to translate.
   */
  role: AppRole;
}

/** A refusal, already in the shape `errorResponse` takes. */
export interface WriteFailure {
  code: ErrorCode;
  message: string;
  details?: unknown;
}

export const WRITE_MESSAGES = {
  draftIncomplete: "Some details are missing or invalid.",
  scheduleUnreadable: "That date and time could not be read.",
  windowNotPositive: "A standby block must end after it starts.",
  notFound: "Reservation not found.",
  notPending: "Only a request still awaiting approval can be changed.",
  reassignOnly:
    "An approved request can only have its driver or van reassigned.",
  notCancellable: "Only a pending or approved request can be cancelled.",
  versionConflict:
    "Someone else updated this request while you had it open. Reload and try again.",
  unknownDriver: "That driver is not on the active roster.",
  unknownVan: "That van is not on the active roster.",
  decisionIncomplete: "This decision is missing a required field.",
  costNegative: "Cost cannot be negative.",
  cancelledByRequestor: "Cancelled by the requestor.",
  cancelledByAdmin: "Cancelled by Admin Support.",
} as const;

const notFound = (): WriteFailure => ({
  code: "NOT_FOUND",
  message: WRITE_MESSAGES.notFound,
});

const invalid = (message: string, details?: unknown): WriteFailure => ({
  code: "VALIDATION_FAILED",
  message,
  details,
});

// ---------------------------------------------------------------------------
// Submit
// ---------------------------------------------------------------------------

/** The mode-dependent columns, resolved once so the insert stays flat. */
interface Schedule {
  startAt: Date;
  endAt: Date | null;
  dropoff: string | null;
  towerHead: string | null;
}

/**
 * Maps one trip's draft fields onto the columns the mode-shape CHECK constraint
 * demands: a pickup carries a dropoff and nothing standby-only; a standby
 * carries an end and a Tower Head and no dropoff. Null means the draft's dates
 * and times could not be read as instants.
 */
function scheduleOf(mode: RideMode, trip: TripDraft): Schedule | null {
  if (mode === "standby") {
    const startAt = instantFromManila(trip.startDate, trip.startTime);
    const endAt = instantFromManila(trip.endDate, trip.endTime);
    if (startAt === null || endAt === null) return null;
    return {
      startAt,
      endAt,
      dropoff: null,
      towerHead: trip.towerHead.trim(),
    };
  }

  const startAt = instantFromManila(trip.pickupDate, trip.pickupTime);
  if (startAt === null) return null;
  return {
    startAt,
    endAt: null,
    dropoff: trip.dropoffPoint.trim(),
    towerHead: null,
  };
}

/**
 * Records a requestor's booking: one `reservations` row per trip in the draft,
 * each with its passengers and a `submitted` event, all in one transaction.
 *
 * Re-runs `validateStep(draft, 4)` rather than trusting the wizard, per that
 * module's own contract — every rule in `draft.ts` is a data-integrity rule and
 * a check that only ever runs in the browser is not a check. Step 4 because it
 * is the union of steps 2 and 3: a requestor can reach Review and edit a field
 * back to empty.
 *
 * Identity comes from `actor`, never from the body. A requestor cannot book in
 * someone else's name by editing the JSON, and `requestor_name`/`_email` are
 * the values the session was minted with.
 */
export async function submitBooking(
  db: Kysely<DB>,
  actor: WriteActor,
  draft: BookingDraft,
  now: Date = new Date(),
): Promise<Result<string[], WriteFailure>> {
  const errors = validateStep(draft, 4);
  if (!isDraftStepValid(errors)) {
    return err(invalid(WRITE_MESSAGES.draftIncomplete, errors));
  }
  // Narrowing only: `validateStep` already rejected the empty site, but its
  // return type cannot tell the compiler that.
  if (draft.site === "") {
    return err(invalid(WRITE_MESSAGES.draftIncomplete, errors));
  }

  const schedules: Schedule[] = [];
  for (const trip of draft.trips) {
    const schedule = scheduleOf(draft.mode, trip);
    if (schedule === null) {
      return err(invalid(WRITE_MESSAGES.scheduleUnreadable));
    }
    // `validateStep` compares the plain date and time strings, which is enough
    // for every draft the wizard can produce. Checking the resolved instants
    // too means a body that reached the same fields another way meets the
    // time-order constraint as a 422, not as a database error surfacing as 500.
    if (schedule.endAt !== null && schedule.endAt <= schedule.startAt) {
      return err(invalid(WRITE_MESSAGES.windowNotPositive));
    }
    schedules.push(schedule);
  }

  // The reference year is the SUBMISSION year in Manila, not UTC: a 31 December
  // 23:30 Manila booking belongs to the closing year even though UTC has
  // already rolled over. See `nextReferenceNo`.
  const submittedIn = instantInManila(now);
  if (submittedIn === null) {
    return err(invalid(WRITE_MESSAGES.scheduleUnreadable));
  }
  const year = Number(submittedIn.date.slice(0, 4));

  const site = SITE_TO_DB[draft.site];
  // Captured while `draft.site` is still narrowed: the check above cannot
  // narrow a property across the transaction callback's closure.
  const siteLabel = draft.site;
  const mobile = normalizeMobile(draft.mobile);

  const references = await db.transaction().execute(async (trx) => {
    const created: string[] = [];

    for (const [index, trip] of draft.trips.entries()) {
      const schedule = schedules[index];
      const reference = await nextReferenceNo(trx, year);

      const row = await trx
        .insertInto("reservations")
        .values({
          reference_no: reference,
          ride_mode: draft.mode,
          status: STATUS_TO_DB.Pending,
          site,
          requestor_user_id: actor.userId,
          requestor_name: actor.name,
          requestor_email: actor.email,
          requestor_mobile: mobile,
          purpose: trip.purpose.trim(),
          details: trip.details.trim(),
          start_at: schedule.startAt,
          end_at: schedule.endAt,
          pickup_location: trip.pickupPoint.trim(),
          dropoff_location: schedule.dropoff,
          approving_tower_head: schedule.towerHead,
        })
        .returning("id")
        .executeTakeFirstOrThrow();

      await trx
        .insertInto("reservation_passengers")
        .values(
          trip.passengers.map((passenger, position) => ({
            reservation_id: row.id,
            // Upper-cased for the same reason the auth provider upper-cases a
            // Domain ID: CGS accepts any case and the column is compared
            // verbatim.
            domain_id: passenger.domainId.trim().toUpperCase(),
            name: passenger.name.trim(),
            // 1-based, matching the dev seed and the detail query's ordering.
            position: position + 1,
          })),
        )
        .execute();

      await trx
        .insertInto("reservation_events")
        .values({
          reservation_id: row.id,
          actor_user_id: actor.userId,
          actor_name: actor.name,
          actor_role: actor.role,
          event_type: "submitted",
        })
        .execute();

      created.push(reference);
    }

    // AFTER the loop, deliberately: one submission is one event, however many
    // trips it carries. Enqueuing beside each `submitted` row would drop three
    // near-identical mails into an inbox in the same second.
    const info = requestInformationFromDraft(draft, created, actor);
    const appUrl = env().APP_URL;
    const trips = created.length;

    // The requestor may themselves be an admin, so they are excluded from the
    // admin notice — otherwise they are told about their own booking.
    const admins = await adminRecipients(trx, siteLabel, actor.email);

    await recordNotification(trx, {
      reservationId: null,
      event: "submitted",
      title: "Request submitted",
      body: `${trips} ${trips === 1 ? "trip" : "trips"} in ${info.site}, pending approval.`,
      // No single reference to deep-link to when a submission is several trips.
      link: "/manage",
      recipientUserId: actor.userId,
      emails: [
        {
          template: "booking-submitted",
          recipient: actor.email,
          payload: { ...info, manageUrl: `${appUrl}/manage` },
        },
        {
          // A site with no notifiable admin queues nothing here, rather than an
          // unsendable row — see `recordNotification`.
          template: "admin-new-request",
          recipient: admins.join(", "),
          payload: { ...info, adminUrl: `${appUrl}/dashboard` },
        },
      ],
    });

    return created;
  });

  return ok(references);
}

// ---------------------------------------------------------------------------
// Cancel
// ---------------------------------------------------------------------------

/**
 * Cancels a request the actor owns.
 *
 * Pending OR Approved, for both roles: an approved trip that is called off has
 * to be withdrawable, by the requestor or by an admin acting for them.
 * Rejected and Cancelled are terminal — there is nothing to withdraw.
 *
 * The reason is optional on the wire but never in the row: the schema's
 * `reservations_cancellation_pairing_check` requires reason and role to travel
 * together, so a blank one becomes a truthful default naming who acted.
 */
export async function cancelReservation(
  db: Kysely<DB>,
  actor: WriteActor,
  referenceNo: string,
  reason: string,
): Promise<Result<null, WriteFailure>> {
  const given = reason.trim();
  const cancellationReason =
    given !== ""
      ? given
      : actor.role === "admin_support"
        ? WRITE_MESSAGES.cancelledByAdmin
        : WRITE_MESSAGES.cancelledByRequestor;

  return db.transaction().execute(async (trx) => {
    const row = await trx
      .selectFrom("reservations")
      .select([
        "id",
        "reference_no",
        "site",
        "requestor_user_id",
        "requestor_email",
        "status",
        "version",
      ])
      .where("reference_no", "=", referenceNo)
      .executeTakeFirst();

    if (row === undefined) return err(notFound());

    // Byte-identical to a real miss, matching `GET /api/reservations/[id]`: an
    // associate must not learn which references exist by probing this endpoint.
    if (
      actor.role !== "admin_support" &&
      row.requestor_user_id !== actor.userId
    ) {
      return err(notFound());
    }

    if (!isCancellable(statusFromDb(row.status))) {
      return err({
        code: "INVALID_TRANSITION",
        message: WRITE_MESSAGES.notCancellable,
      });
    }

    const result = await trx
      .updateTable("reservations")
      .set({
        status: STATUS_TO_DB.Cancelled,
        cancellation_reason: cancellationReason,
        cancelled_by_role: actor.role,
        version: row.version + 1,
        updated_at: new Date(),
      })
      .where("id", "=", row.id)
      // Compare-and-set on the version just read. No caller supplies one here —
      // the guard is against a concurrent admin decision landing between this
      // transaction's SELECT and its UPDATE, which would otherwise be
      // overwritten silently.
      .where("version", "=", row.version)
      .executeTakeFirst();

    if (Number(result.numUpdatedRows) === 0) {
      return err({
        code: "VERSION_CONFLICT",
        message: WRITE_MESSAGES.versionConflict,
      });
    }

    await trx
      .insertInto("reservation_events")
      .values({
        reservation_id: row.id,
        actor_user_id: actor.userId,
        actor_name: actor.name,
        actor_role: actor.role,
        event_type: "cancelled",
        remark: cancellationReason,
      })
      .execute();

    const info = await loadRequestInformation(trx, row.id);
    const byAdmin = actor.role === "admin_support";
    // Exclude whoever acted, same as `decideReservation`'s cc and submitBooking's
    // admin notice: the requestor's own address when they cancelled, the acting
    // admin's when Admin Support did — otherwise the actor is cc'd on, or
    // duplicated into, an email about their own action.
    const admins = await adminRecipients(
      trx,
      siteFromDb(row.site),
      byAdmin ? actor.email : row.requestor_email,
    );

    await recordNotification(trx, {
      reservationId: row.id,
      event: "cancelled",
      title: "Van reservation cancelled",
      body: `${row.reference_no} was cancelled by ${byAdmin ? "Admin Support" : "the requestor"}.`,
      link: `/manage?ref=${row.reference_no}`,
      // The in-app notice always goes to the requestor, even when they cancelled
      // it themselves: the bell is that trip's history, not only news to them.
      recipientUserId: row.requestor_user_id,
      emails: [
        {
          template: "booking-status-change",
          // Whoever did NOT act is the one who needs telling.
          recipient: byAdmin ? row.requestor_email : admins.join(", "),
          cc: byAdmin ? admins : [],
          payload: {
            ...info,
            manageUrl: `${env().APP_URL}/manage`,
            status: "Cancelled",
            cancelledBy: actor.role,
            cancellationReason,
          },
        },
      ],
    });

    return ok(null);
  });
}

// ---------------------------------------------------------------------------
// Admin decision
// ---------------------------------------------------------------------------

/** The trip fields the drawer unlocks behind "trip details changed". */
export interface TripEdit {
  purpose: string;
  details: string;
  pickupPoint: string;
  dropoffPoint: string | null;
  startDate: string;
  startTime: string;
  endDate: string | null;
  endTime: string | null;
  /** Admin bookkeeping, legal on either mode. */
  vendor: string | null;
  costPhp: number | null;
}

export interface DecisionInput {
  /** The row version the drawer read. See the version guard below. */
  version: number;
  /** Null is a legal save: the admin edited fields without deciding. */
  decision: Decision | null;
  rejectionReason: string;
  /**
   * `null` means "leave this side unchanged" — which is what lets an admin
   * assign a van without touching the driver. There is no way to CLEAR an
   * assignment: nothing asks for one, and an approved trip cannot be unassigned
   * without violating `reservations_approved_driver_check` /
   * `reservations_approved_van_check` anyway.
   *
   * The two sides are independent by design. A roster van with a rental driver
   * (a relief driver in a company van) and a roster driver with a rental van
   * (own driver, hired unit) are both legal; each CHECK constraint polices its
   * own side.
   */
  driver: DriverInput | null;
  van: VanInput | null;
  trip: TripEdit | null;
}

export interface DecisionOutcome {
  reference: string;
  status: string;
  version: number;
}

/** The columns a `modified` event is about — the requestor's trip, not the admin's. */
const TRIP_FIELDS = [
  { field: "purpose", label: "Purpose" },
  { field: "details", label: "Details" },
  { field: "pickupPoint", label: "Pickup point" },
  { field: "dropoffPoint", label: "Drop-off point" },
  { field: "startAt", label: "Start" },
  { field: "endAt", label: "End" },
] as const;

/** An instant as the Manila wall-clock string a human will read it back as. */
function displayInstant(value: Date | null): string | null {
  if (value === null) return null;
  const parts = instantInManila(value);
  if (parts === null) return null;
  return formatPlainDateTime(parts.date, parts.time);
}

/**
 * Applies an Admin Support decision, the drawer's field edits, or both.
 *
 * Three guards, in order, each answering a different question:
 *
 * 1. **Transition** — every write here requires a pending row. Approving a
 *    cancelled request, or editing a rejected one, are both meaningless, and
 *    refusing them costs one comparison.
 * 2. **Rules** — `validateDecisionInput` re-runs the drawer's two checks. Both
 *    are also CHECK constraints, so skipping them would not permit bad data; it
 *    would turn a field error into a 500.
 * 3. **Version** — the UPDATE applies only against the version the caller read.
 *    Two admins with the same request open both pass guards 1 and 2; the second
 *    to save updates zero rows and gets `VERSION_CONFLICT` instead of quietly
 *    overwriting the first one's decision.
 */
/**
 * What this save is allowed to do to this row.
 *
 * `full`     — a pending request: decide it, edit its trip, assign either side.
 * `reassign` — an approved request: move the driver or the van, nothing else.
 * `null`     — refused.
 *
 * A reassign is recognised by what the request does NOT carry — no decision and
 * no trip edit — rather than by a `mode` field on the wire. That keeps
 * `decisionInputSchema` unchanged and makes the endpoint's authority a function
 * of the request's own content, which no client flag can widen.
 */
function writeModeFor(
  status: ReservationStatus,
  input: DecisionInput,
): "full" | "reassign" | null {
  if (isRequestorEditable(status)) return "full";
  if (
    isReassignable(status) &&
    input.decision === null &&
    input.trip === null &&
    (input.driver !== null || input.van !== null)
  ) {
    return "reassign";
  }
  return null;
}

export async function decideReservation(
  db: Kysely<DB>,
  actor: WriteActor,
  referenceNo: string,
  input: DecisionInput,
): Promise<Result<DecisionOutcome, WriteFailure>> {
  const errors = validateDecisionInput(input);
  if (!isDecisionValid(errors)) {
    return err(invalid(WRITE_MESSAGES.decisionIncomplete, errors));
  }
  if (input.trip !== null && input.trip.costPhp !== null) {
    if (input.trip.costPhp < 0) {
      return err(invalid(WRITE_MESSAGES.costNegative));
    }
  }

  return db.transaction().execute(async (trx) => {
    const row = await trx
      .selectFrom("reservations as r")
      // For the audit log's "from" side: an id cannot be read back as a name
      // years later if the roster row has since changed or gone.
      .leftJoin("drivers as d", "d.id", "r.assigned_driver_id")
      .leftJoin("vans as v", "v.id", "r.assigned_van_id")
      .select([
        "r.id",
        "r.reference_no",
        "r.status",
        "r.version",
        "r.ride_mode",
        "r.assigned_driver_id",
        "r.assigned_van_id",
        "r.rental_driver_name",
        "r.rental_plate",
        "r.purpose",
        "r.details",
        "r.pickup_location",
        "r.dropoff_location",
        "r.start_at",
        "r.end_at",
        // For the notification: who to tell, where, and which admins to copy.
        "r.site",
        "r.requestor_user_id",
        "r.requestor_email",
        "d.name as roster_driver_name",
        "v.van_number as roster_van_number",
        "v.plate as roster_van_plate",
      ])
      .where("r.reference_no", "=", referenceNo)
      .executeTakeFirst();

    if (row === undefined) return err(notFound());
    const status = statusFromDb(row.status);
    const mode = writeModeFor(status, input);
    if (mode === null) {
      return err({
        code: "INVALID_TRANSITION",
        message: isReassignable(status)
          ? WRITE_MESSAGES.reassignOnly
          : WRITE_MESSAGES.notPending,
      });
    }

    // Only when the assignment is actually CHANGING. Re-sending what the request
    // already carries is a no-op, and checking it anyway would let a driver or
    // van deactivated AFTER being assigned block every later save on that
    // request — including a rejection, which needs neither.
    //
    // The names come back with the validation, not from a second query: the
    // audit log's "to" side needs them, and this is the one place a roster id
    // is already being resolved.
    let nextDriverName: string | null = null;
    let nextVanName: string | null = null;
    if (
      input.driver?.source === "roster" &&
      input.driver.driverId !== row.assigned_driver_id
    ) {
      const driver = await trx
        .selectFrom("drivers")
        .select(["id", "name"])
        .where("id", "=", input.driver.driverId)
        .where("active", "=", true)
        .executeTakeFirst();
      if (driver === undefined) {
        return err(invalid(WRITE_MESSAGES.unknownDriver));
      }
      nextDriverName = driver.name;
    }
    if (
      input.van?.source === "roster" &&
      input.van.vanId !== row.assigned_van_id
    ) {
      const van = await trx
        .selectFrom("vans")
        .select(["id", "van_number", "plate"])
        .where("id", "=", input.van.vanId)
        .where("active", "=", true)
        .executeTakeFirst();
      if (van === undefined) {
        return err(invalid(WRITE_MESSAGES.unknownVan));
      }
      nextVanName = van.van_number ?? van.plate;
    }

    const nextVersion = input.version + 1;
    const update: Updateable<Reservations> = {
      version: nextVersion,
      updated_at: new Date(),
    };

    let changed: FieldChange[] = [];
    if (input.trip !== null) {
      const applied = applyTripEdit(row, input.trip);
      if ("failure" in applied) return err(applied.failure);
      Object.assign(update, applied.columns);
      changed = applied.changed;
    }

    // Each side sets its own columns and NULLS the other source's, so a driver
    // or van moving between roster and rental cannot leave both populated and
    // violate `reservations_driver_source_check` / `reservations_van_source_check`.
    if (input.driver !== null) {
      const applied = driverColumns(input.driver);
      if ("failure" in applied) return err(applied.failure);
      Object.assign(update, applied.columns);
    }
    if (input.van !== null) {
      const applied = vanColumns(input.van);
      if ("failure" in applied) return err(applied.failure);
      Object.assign(update, applied.columns);
    }
    if (input.decision === "approve") {
      update.status = STATUS_TO_DB.Approved;
    }
    if (input.decision === "reject") {
      update.status = STATUS_TO_DB.Rejected;
      update.rejection_reason = input.rejectionReason.trim();
    }

    // Only when a side actually MOVED. `driverMoved`/`vanMoved` compare on
    // identity, so correcting a rental driver's mobile number writes the columns
    // without relabelling the trip — the status names a reassignment, not a
    // save. A row already at this status stays there: "the assignment has
    // changed since approval" remains true, and it is not a counter.
    if (
      mode === "reassign" &&
      (driverMoved(row, input.driver) || vanMoved(row, input.van))
    ) {
      update.status = STATUS_TO_DB["Approved - Driver Reassigned"];
    }

    const result = await trx
      .updateTable("reservations")
      .set(update)
      .where("id", "=", row.id)
      .where("version", "=", input.version)
      .executeTakeFirst();

    if (Number(result.numUpdatedRows) === 0) {
      return err({
        code: "VERSION_CONFLICT",
        message: WRITE_MESSAGES.versionConflict,
      });
    }

    await recordDecisionEvents(trx, actor, row, input, changed, {
      driver: nextDriverName,
      van: nextVanName,
    });

    const outcome = {
      reference: row.reference_no,
      status: update.status ?? row.status,
      version: nextVersion,
    };

    const link = `/manage?ref=${row.reference_no}`;
    const manageUrl = `${env().APP_URL}/manage`;

    // `decision: null` is a LEGAL save — the admin edited fields without
    // deciding. Most such saves are not news, but ONE is: a change to who or
    // what is running the trip. Without this branch it would be silent, and
    // "driver changed" is one of the six events the requestor is promised.
    if (input.decision === null) {
      if (!driverMoved(row, input.driver) && !vanMoved(row, input.van)) {
        return ok(outcome);
      }

      // One notice covers both sides, so "first time" means the trip carried NO
      // assignment at all before this save. A van added to a trip that already
      // named a driver is a CHANGE to an assignment the requestor has already
      // been told about, not a first one.
      const firstTime = !isAssigned(row);
      await recordNotification(trx, {
        reservationId: row.id,
        // The event VALUES stay `driver_*`: they are stored in
        // `notification_events.event` under a CHECK constraint, and renaming
        // them buys nothing a requestor ever sees. The copy is neutral instead,
        // because one notice now covers a van move, a driver move, or both.
        event: firstTime ? "driver_assigned" : "driver_changed",
        title: firstTime ? "Van assignment set" : "Van assignment changed",
        body: `${row.reference_no} — the van assignment has been ${firstTime ? "set" : "changed"}.`,
        link,
        recipientUserId: row.requestor_user_id,
        emails: [
          {
            template: "driver-assignment",
            recipient: row.requestor_email,
            cc: await adminRecipients(
              trx,
              siteFromDb(row.site),
              row.requestor_email,
            ),
            payload: {
              ...(await loadRequestInformation(trx, row.id)),
              manageUrl,
              change: firstTime ? "assigned" : "changed",
            },
          },
        ],
      });

      return ok(outcome);
    }

    const approved = input.decision === "approve";
    await recordNotification(trx, {
      reservationId: row.id,
      event: approved ? "approved" : "rejected",
      title: approved
        ? "Van reservation approved"
        : "Van reservation not approved",
      body: approved
        ? `${row.reference_no} is approved.`
        : `${row.reference_no} was not approved.`,
      link,
      recipientUserId: row.requestor_user_id,
      emails: [
        {
          // The status is a payload field, so one template covers all three
          // decided outcomes. See `booking-status-change.tsx`.
          template: "booking-status-change",
          recipient: row.requestor_email,
          cc: await adminRecipients(
            trx,
            siteFromDb(row.site),
            row.requestor_email,
          ),
          payload: {
            ...(await loadRequestInformation(trx, row.id)),
            manageUrl,
            ...(approved
              ? { status: "Approved" }
              : {
                  status: "Rejected",
                  rejectionReason: input.rejectionReason.trim(),
                }),
          },
        },
      ],
    });

    return ok(outcome);
  });
}

/** The subset of the fetched row an edit compares against. */
interface CurrentTrip {
  ride_mode: string;
  purpose: string;
  details: string;
  pickup_location: string;
  dropoff_location: string | null;
  start_at: Date;
  end_at: Date | null;
}

/**
 * Turns a `TripEdit` into columns, per mode, and names which of the requestor's
 * fields actually moved.
 *
 * Mode decides which columns are even writable: the mode-shape CHECK constraint
 * forbids an end and a Tower Head on a pickup, and forbids a dropoff on a
 * standby. Vendor and cost are legal on either mode. Filtering here rather
 * than trusting the body means a client that sends the wrong half gets those
 * fields ignored instead of a constraint violation surfacing as a 500.
 */
function applyTripEdit(
  current: CurrentTrip,
  edit: TripEdit,
):
  | { columns: Updateable<Reservations>; changed: FieldChange[] }
  | { failure: WriteFailure } {
  const standby = current.ride_mode === "standby";

  const startAt = instantFromManila(edit.startDate, edit.startTime);
  if (startAt === null) {
    return { failure: invalid(WRITE_MESSAGES.scheduleUnreadable) };
  }

  let endAt: Date | null = null;
  if (standby) {
    if (edit.endDate === null || edit.endTime === null) {
      return { failure: invalid(WRITE_MESSAGES.scheduleUnreadable) };
    }
    endAt = instantFromManila(edit.endDate, edit.endTime);
    if (endAt === null) {
      return { failure: invalid(WRITE_MESSAGES.scheduleUnreadable) };
    }
    if (endAt <= startAt) {
      return { failure: invalid(WRITE_MESSAGES.windowNotPositive) };
    }
  }

  const dropoff = standby ? null : (edit.dropoffPoint ?? "").trim();
  if (dropoff !== null && dropoff === "") {
    return { failure: invalid(WRITE_MESSAGES.draftIncomplete) };
  }

  const purpose = edit.purpose.trim();
  const details = edit.details.trim();
  const pickup = edit.pickupPoint.trim();
  if (
    purpose === "" ||
    details === "" ||
    pickup === "" ||
    !isTripPurpose(purpose)
  ) {
    return { failure: invalid(WRITE_MESSAGES.draftIncomplete) };
  }

  const columns: Updateable<Reservations> = {
    purpose,
    details,
    pickup_location: pickup,
    dropoff_location: dropoff,
    start_at: startAt,
    end_at: endAt,
    vendor: edit.vendor === null ? null : edit.vendor.trim() || null,
    cost_php: edit.costPhp,
  };

  // Only the requestor's fields count as a modification. Vendor and cost are
  // admin bookkeeping the requestor never entered, so filling them in must not
  // flag the request as "Changed Trip Details" to the next reviewer.
  //
  // Both sides are recorded as DISPLAY strings, formatted here rather than at
  // render time: `reservation_events` is append-only, so a row has to carry
  // everything needed to read it back without re-deriving anything from a
  // schema that has since moved.
  const sides: Record<string, { from: string | null; to: string | null }> = {
    purpose: { from: current.purpose, to: purpose },
    details: { from: current.details, to: details },
    pickupPoint: { from: current.pickup_location, to: pickup },
    dropoffPoint: { from: current.dropoff_location, to: dropoff },
    startAt: {
      from: displayInstant(current.start_at),
      to: displayInstant(startAt),
    },
    endAt: { from: displayInstant(current.end_at), to: displayInstant(endAt) },
  };

  const moved = (field: (typeof TRIP_FIELDS)[number]["field"]): boolean => {
    if (field === "purpose") return purpose !== current.purpose;
    if (field === "details") return details !== current.details;
    if (field === "pickupPoint") return pickup !== current.pickup_location;
    if (field === "dropoffPoint") return dropoff !== current.dropoff_location;
    if (field === "startAt")
      return startAt.getTime() !== current.start_at.getTime();
    return (endAt?.getTime() ?? null) !== (current.end_at?.getTime() ?? null);
  };

  // Compared on the raw values, reported as the formatted ones — two edits that
  // format identically are still two different instants.
  const changed: FieldChange[] = TRIP_FIELDS.filter(({ field }) =>
    moved(field),
  ).map(({ field, label }) => ({ field, label, ...sides[field] }));

  return { columns, changed };
}

// ---------------------------------------------------------------------------
// Assignment: driver and van, roster or rental, each side independent
// ---------------------------------------------------------------------------

/** The four columns that answer "who and what is running this trip". */
interface Assignment {
  assigned_driver_id: string | null;
  rental_driver_name: string | null;
  assigned_van_id: string | null;
  rental_plate: string | null;
}

const hasDriver = (row: Assignment): boolean =>
  row.assigned_driver_id !== null || row.rental_driver_name !== null;

const hasVan = (row: Assignment): boolean =>
  row.assigned_van_id !== null || row.rental_plate !== null;

const isAssigned = (row: Assignment): boolean => hasDriver(row) || hasVan(row);

/**
 * Did this side's assignment actually move?
 *
 * Compared on IDENTITY — the roster id, or the rental's name and plate. A
 * correction to a rental driver's mobile or a rental van's car type still writes
 * the columns, but it is a detail edit, not a reassignment: it must not spend an
 * audit event or a mail to the requestor.
 */
function driverMoved(row: Assignment, driver: DriverInput | null): boolean {
  if (driver === null) return false;
  if (driver.source === "roster") {
    return driver.driverId !== row.assigned_driver_id;
  }
  return driver.name.trim() !== row.rental_driver_name;
}

/**
 * The assignment as the audit log names it — the roster row's own name, joined
 * in by `decideReservation`, or the rental's typed-in one.
 */
interface AuditedAssignment extends Assignment {
  roster_driver_name: string | null;
  roster_van_number: string | null;
  roster_van_plate: string | null;
}

function driverNameOf(row: AuditedAssignment): string | null {
  return row.roster_driver_name ?? row.rental_driver_name;
}

/** A van number where there is one; a rental often has only a plate. */
function vanNameOf(row: AuditedAssignment): string | null {
  return row.roster_van_number ?? row.roster_van_plate ?? row.rental_plate;
}

function vanMoved(row: Assignment, van: VanInput | null): boolean {
  if (van === null) return false;
  if (van.source === "roster") return van.vanId !== row.assigned_van_id;
  return van.plate.trim() !== row.rental_plate;
}

/**
 * One side of the assignment as columns, the other source's cleared.
 *
 * A required rental field that trims to nothing is refused rather than stored:
 * the pair CHECK constraints demand only that name and mobile (or plate and car
 * type) travel TOGETHER, so a blank one satisfies the database while leaving an
 * assignment the drawer renders empty and the mail cannot send at all — every
 * string in the template payload is `min(1)`.
 */
function driverColumns(
  driver: DriverInput,
): { columns: Updateable<Reservations> } | { failure: WriteFailure } {
  if (driver.source === "roster") {
    return {
      columns: {
        assigned_driver_id: driver.driverId,
        rental_driver_name: null,
        rental_driver_mobile: null,
      },
    };
  }

  const name = driver.name.trim();
  // Digits only, as `submitBooking` stores the requestor's own number.
  const mobile = normalizeMobile(driver.mobile);
  if (name === "" || mobile === "") {
    return { failure: invalid(WRITE_MESSAGES.decisionIncomplete) };
  }
  return {
    columns: {
      assigned_driver_id: null,
      rental_driver_name: name,
      rental_driver_mobile: mobile,
    },
  };
}

function vanColumns(
  van: VanInput,
): { columns: Updateable<Reservations> } | { failure: WriteFailure } {
  if (van.source === "roster") {
    return {
      columns: {
        assigned_van_id: van.vanId,
        rental_van_number: null,
        rental_plate: null,
        rental_car_type: null,
      },
    };
  }

  const plate = van.plate.trim();
  const carType = van.carType.trim();
  if (plate === "" || carType === "") {
    return { failure: invalid(WRITE_MESSAGES.decisionIncomplete) };
  }
  return {
    columns: {
      assigned_van_id: null,
      // The one optional rental field, and `reservations_rental_van_number_check`
      // will not let it outlive the plate it identifies.
      rental_van_number: van.vanNumber?.trim() || null,
      rental_plate: plate,
      rental_car_type: carType,
    },
  };
}

/**
 * Writes the audit trail for one decision, in the order the events happened.
 *
 * `changes` records which fields moved. Nothing reads it today — the list
 * derives its "Changed Trip Details" remark from the event's existence alone —
 * but this is an append-only log, and a field that was not captured at the
 * moment of the change cannot be recovered afterwards.
 */
async function recordDecisionEvents(
  trx: Transaction<DB>,
  actor: WriteActor,
  row: AuditedAssignment & { id: string },
  input: DecisionInput,
  changed: FieldChange[],
  /** Roster names resolved during validation; null when the side is a rental. */
  incoming: { driver: string | null; van: string | null },
): Promise<void> {
  const base = {
    reservation_id: row.id,
    actor_user_id: actor.userId,
    actor_name: actor.name,
    actor_role: actor.role,
  };
  const events: Insertable<ReservationEvents>[] = [];

  if (changed.length > 0) {
    events.push({
      ...base,
      event_type: "modified",
      changes: JSON.stringify({ fields: changed }),
    });
  }

  if (driverMoved(row, input.driver)) {
    events.push({
      ...base,
      // `first_assigned_at` — the TAT and SLA basis — is the earliest
      // `driver_assigned`. A reassignment must not reset it, so it gets its own
      // event type rather than a second assignment.
      event_type: hasDriver(row) ? "driver_reassigned" : "driver_assigned",
      changes: JSON.stringify({
        fields: [
          {
            field: "driver",
            label: "Driver",
            from: driverNameOf(row),
            // A rental has no roster row to name it — the typed-in name IS the
            // record.
            to:
              input.driver?.source === "rental"
                ? input.driver.name.trim()
                : incoming.driver,
          },
        ],
      }),
    });
  }
  if (vanMoved(row, input.van)) {
    events.push({
      ...base,
      // Split for the same reason, per side: the van has its own first
      // assignment, distinguishable in the log from every later one. Nothing
      // derives a TAT from it today — `first_assigned_at` is min(driver_assigned)
      // alone (see `repo.ts`) — but this is an append-only log, and a
      // distinction not captured at the time cannot be recovered later.
      event_type: hasVan(row) ? "van_reassigned" : "van_assigned",
      changes: JSON.stringify({
        fields: [
          {
            field: "van",
            label: "Van",
            from: vanNameOf(row),
            to:
              input.van?.source === "rental"
                ? input.van.vanNumber?.trim() || input.van.plate.trim()
                : incoming.van,
          },
        ],
      }),
    });
  }

  if (input.decision === "approve") {
    events.push({ ...base, event_type: "approved" });
  }
  if (input.decision === "reject") {
    events.push({
      ...base,
      event_type: "rejected",
      remark: input.rejectionReason.trim(),
    });
  }

  if (events.length === 0) return;
  await trx.insertInto("reservation_events").values(events).execute();
}
