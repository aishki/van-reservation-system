"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  BUTTON_PRIMARY,
  BUTTON_SECONDARY,
  FOCUS_RING,
} from "@/components/admin/admin-theme";
import {
  DrawerField,
  DrawerReadout,
  DrawerSection,
  DrawerSelect,
  DrawerTextArea,
} from "@/components/admin/trip-drawer/drawer-parts";
import { RentalTag } from "@/components/common/rental-tag";
import { StatusChip } from "@/components/common/status-chip";
import { TooltipPortalContainer } from "@/components/ui/tooltip";
import { ApiError, apiFetch } from "@/lib/api-fetcher";
import {
  EM_DASH,
  formatInstant,
  formatPlainDate,
  formatPlainTime,
} from "@/lib/tz";
import { cn } from "@/lib/utils";
import type { Driver } from "@/modules/drivers/types";
import {
  DECISION_LABELS,
  DECISION_MESSAGES,
  DECISIONS,
  type Decision,
  type DecisionErrors,
  isDecisionValid,
  saveLabelFor,
  validateDecisionInput,
} from "@/modules/reservations/decision";
import { normalizeMobile } from "@/modules/reservations/draft";
import {
  ADMIN_RESERVATIONS_KEY,
  reservationDetailKey,
} from "@/modules/reservations/query-keys";
import { isTripPurpose, TRIP_PURPOSES } from "@/modules/reservations/reference";
import type {
  AssignedDriver,
  AssignedVan,
  DriverInput,
  ReservationDetail,
  ReservationStatus,
  VanInput,
} from "@/modules/reservations/types";
import { RIDE_MODE_LABELS } from "@/modules/reservations/types";
import type { Van } from "@/modules/vans/types";

export interface DecisionResult {
  id: string;
  status: ReservationStatus;
  decidedBy: string;
}

/**
 * Which job this drawer is open for.
 *
 * `decide`   — the Master List's review flow: approve, reject, edit the trip.
 * `reassign` — an approved trip whose driver or van is moving. The trip fields
 *              stay locked with no unlock at all: nobody asked to edit an
 *              approved trip's details, and doing so would silently change a
 *              trip the requestor has already been told about.
 */
export type TripDrawerMode = "decide" | "reassign";

interface TripDrawerProps {
  detail: ReservationDetail;
  /** The signed-in admin — recorded as the approver. */
  adminName: string;
  /** Pre-selected when opened from the row menu's Approve/Reject. */
  initialDecision: Decision | null;
  /** Defaults to `decide`, so every existing call site is unchanged. */
  mode?: TripDrawerMode;
  onClose: () => void;
  onDecided: (result: DecisionResult) => void;
}

const APPROVAL = "Admin Approval";
const DRIVER_AND_VAN = "Driver & Van";
const COSTING = "Additional Costing";

/**
 * The value both selects use for manual entry. Not a uuid, so it can never
 * collide with a roster id.
 */
const OTHERS = "__others__";

/** `TRIP_PURPOSES` as `DrawerSelect` options — the vocabulary is closed and
 * enforced server-side, so free text here would only earn the admin a 422. */
const PURPOSE_OPTIONS = TRIP_PURPOSES.map((purpose) => ({
  value: purpose,
  label: purpose,
}));

/**
 * Editable trip fields, as one flat record so a reset is one assignment.
 *
 * A ROSTER assignment is an id, not a name and a set of contact fields. Mobile
 * and shift belong to the `drivers` row, plate and car type to the `vans` row,
 * and `reservations` stores only the two ids — so the design's editable inputs
 * are bound to nothing, and whatever an admin typed into them would be
 * discarded on save. They are readouts of the selection instead.
 *
 * A RENTAL is the exact inverse: it has no roster row, so the typed text IS
 * what gets stored, and the `rental*` fields below are real inputs.
 */
interface DetailDraft {
  purpose: string;
  details: string;
  pickupPoint: string;
  dropoffPoint: string;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  vendor: string;
  cost: string;
  /** A roster id, `OTHERS`, or `""` for unassigned — the placeholder value. */
  driverId: string;
  rentalDriverName: string;
  rentalDriverMobile: string;
  /** A roster id, `OTHERS`, or `""` for unassigned — the placeholder value. */
  vanId: string;
  rentalVanNumber: string;
  rentalPlate: string;
  rentalCarType: string;
}

function draftFrom(detail: ReservationDetail): DetailDraft {
  const driver = detail.assignedDriver;
  const van = detail.assignedVan;
  return {
    purpose: detail.purpose,
    details: detail.details,
    pickupPoint: detail.pickupPoint,
    dropoffPoint: detail.dropoffPoint ?? "",
    startDate: detail.startDate,
    startTime: detail.startTime,
    endDate: detail.endDate ?? "",
    endTime: detail.endTime ?? "",
    vendor: detail.vendor ?? "",
    cost: detail.costPhp === null ? "" : String(detail.costPhp),
    driverId: selectionOf(driver?.source, rosterDriverId(detail)),
    rentalDriverName: driver?.source === "rental" ? driver.name : "",
    rentalDriverMobile: driver?.source === "rental" ? driver.mobile : "",
    vanId: selectionOf(van?.source, rosterVanId(detail)),
    rentalVanNumber: van?.source === "rental" ? (van.vanNumber ?? "") : "",
    rentalPlate: van?.source === "rental" ? van.plate : "",
    rentalCarType: van?.source === "rental" ? van.carType : "",
  };
}

/** A stored assignment as its select's value — the id, `OTHERS`, or `""`. */
function selectionOf(
  source: "roster" | "rental" | undefined,
  rosterId: string,
): string {
  if (source === undefined) return "";
  return source === "roster" ? rosterId : OTHERS;
}

const COST_MESSAGE = "Enter a whole number of pesos, or leave it blank.";

/**
 * A rental field the write path refuses blank (`wire.ts` puts `min(1)` on each
 * of them). Checked here so the refusal lands on the field rather than arriving
 * as a schema parse error with nothing to point at.
 */
const RENTAL_MESSAGE = "Required for a rental.";

/**
 * `driverColumns` in write.ts strips everything but digits from the rental
 * mobile before checking it is non-empty, so typing free text into this
 * field (nothing wrong with the shape — it is just text, not a phone number)
 * normalizes to `""` server-side and comes back as a 422 pointing at no
 * field at all. Checked here first, same reasoning as `COST_MESSAGE`.
 */
const RENTAL_MOBILE_MESSAGE = "Enter a mobile number, e.g. 0917 123 4567.";

/**
 * `applyTripEdit` refuses a blank `details` with a generic
 * `WRITE_MESSAGES.draftIncomplete`, which points at no field. Checked here,
 * same as `COST_MESSAGE` and `RENTAL_MESSAGE`, so the admin sees it on Details
 * instead of a 422 with nothing to act on.
 */
const DETAILS_MESSAGE = "Add details for this trip's purpose.";

/** Separate from `DecisionErrors`: these are field rules, not decision rules. */
interface RentalErrors {
  name?: string;
  mobile?: string;
  plate?: string;
  carType?: string;
}

/** `""` → null; anything that is not a non-negative integer → `undefined`. */
function parseCost(value: string): number | null | undefined {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < 0) return undefined;
  return parsed;
}

/**
 * The Trip Details review panel.
 *
 * A native `<dialog>` driven by `showModal()`, not the design's fixed-position
 * overlay div. Only `showModal()` produces a real modal — focus trapped inside,
 * the rest of the page inert, Escape wired to `cancel`, focus restored to the
 * trigger on close. `<dialog open>` looks identical and delivers none of it.
 * Positioned as a right-hand slide-over by resetting the element's default
 * centring (`m-0 ml-auto`) rather than by wrapping it in a flex container.
 *
 * One departure from the design worth naming:
 *
 * - **Driver assignment is not gated behind the "trip details changed"
 *   checkbox.** The design locks every field, including Driver, until that box
 *   is ticked — so approving a request would require first declaring that its
 *   trip details changed, which is untrue. Assigning a driver is not editing
 *   the requestor's trip; it is the approval itself (FR-13).
 *
 * Additional Costing (Vendor + Additional Cost) renders for both pickup and
 * standby: a pickup can incur a rented-van cost just as a standby block can,
 * and `costPhp`/`vendor` are admin bookkeeping unrelated to which mode the
 * requestor picked.
 */
export function TripDrawer({
  detail,
  adminName,
  initialDecision,
  mode = "decide",
  onClose,
  onDecided,
}: TripDrawerProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const queryClient = useQueryClient();
  const [decision, setDecision] = useState<Decision | null>(initialDecision);
  const [rejectionReason, setRejectionReason] = useState("");
  const [editable, setEditable] = useState(false);
  // The checkbox is not rendered in reassign mode, so `editable` can only be
  // false there — but deriving it rather than trusting that means a future edit
  // to the checkbox cannot quietly unlock an approved trip's fields.
  const tripEditable = mode === "decide" && editable;
  // Vendor and cost are admin bookkeeping, not a requestor-entered trip
  // field — see `CostingEdit` in write.ts, which is the reassign-mode's own
  // door to them (a reassign refuses a full `TripEdit` outright, since an
  // approved request's trip fields stay locked). A reassignment has no "trip
  // details changed" checkbox to gate behind, but that checkbox was never
  // what costing needed either, so it stays open there instead of locking
  // behind a control this mode does not render.
  const costEditable = mode === "reassign" || tripEditable;
  const [draft, setDraft] = useState<DetailDraft>(() => draftFrom(detail));
  const [showErrors, setShowErrors] = useState(false);
  const [serverErrors, setServerErrors] = useState<DecisionErrors>({});
  const [saving, setSaving] = useState(false);
  const [openSections, setOpenSections] = useState<string[]>(() => [
    APPROVAL,
    ...(initialDecision === "approve" ? [DRIVER_AND_VAN] : []),
  ]);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  const standby = detail.mode === "standby";

  // The roster backs the driver select. Admin-only, like this drawer, and
  // shared across every request opened in this session — hence a plain
  // `["drivers"]` key with the global 30s staleTime rather than a per-request
  // fetch.
  const driversQuery = useQuery({
    queryKey: ["drivers"],
    queryFn: () => apiFetch<Driver[]>("/api/drivers"),
  });
  const roster = driversQuery.data ?? [];
  // The fleet backs the van select, on the same terms as the roster above.
  const vansQuery = useQuery({
    queryKey: ["vans"],
    queryFn: () => apiFetch<Van[]>("/api/vans"),
  });
  const fleet = vansQuery.data ?? [];
  // A deactivated driver stays selectable only where they are already assigned,
  // so reopening an old request does not silently drop its driver.
  const driverOptions = [
    ...roster
      .filter((driver) => driver.active || driver.id === rosterDriverId(detail))
      .map((driver) => ({ value: driver.id, label: driver.name })),
    { value: OTHERS, label: "Others…" },
  ];
  // Same rule for a retired van.
  const vanOptions = [
    ...fleet
      .filter((van) => van.active || van.id === rosterVanId(detail))
      .map((van) => ({
        value: van.id,
        label: `${van.vanNumber} · ${van.plate}`,
      })),
    { value: OTHERS, label: "Others…" },
  ];

  // `reservations.purpose` has no database CHECK — only `isTripPurpose` at the
  // write path — so a row from before the vocabulary consolidation can hold a
  // value outside `TRIP_PURPOSES`. Kept selectable, same rule as the retired
  // driver/van above, so the admin sees what is actually recorded instead of
  // a blank placeholder that reads as "nothing saved".
  const purposeOptions = isTripPurpose(detail.purpose)
    ? PURPOSE_OPTIONS
    : [
        {
          value: detail.purpose,
          label: `${detail.purpose} (not on this list)`,
        },
        ...PURPOSE_OPTIONS,
      ];
  const rentalDriver = draft.driverId === OTHERS;
  const rentalVan = draft.vanId === OTHERS;
  const selectedDriver = rosterDriverOf(draft.driverId, roster, detail);
  const selectedVan = rosterVanOf(draft.vanId, fleet, detail);

  // Both sides are read off the draft, which was seeded from the stored
  // assignment — so a save always sends the driver and van this panel is
  // showing, whether or not the admin touched them. `null` here means "leave
  // unchanged", which `validateDecisionInput` flattens to "not assigned": an
  // approve-only save that sent one side as null would be refused for a field
  // the request already has.
  const driverInput = driverInputOf(draft);
  const vanInput = vanInputOf(draft);
  const errors = validateDecisionInput({
    decision,
    rejectionReason,
    driver: driverInput,
    van: vanInput,
  });
  const costError =
    costEditable && parseCost(draft.cost) === undefined
      ? COST_MESSAGE
      : undefined;
  const detailsError =
    tripEditable && draft.details.trim() === "" ? DETAILS_MESSAGE : undefined;
  const rentalErrors: RentalErrors = {
    name: blankRental(rentalDriver, draft.rentalDriverName),
    mobile: rentalMobileError(rentalDriver, draft.rentalDriverMobile),
    plate: blankRental(rentalVan, draft.rentalPlate),
    carType: blankRental(rentalVan, draft.rentalCarType),
  };
  const rentalIncomplete = Object.values(rentalErrors).some(
    (message) => message !== undefined,
  );
  // Errors appear on the first save attempt, not while typing. Marking a field
  // red before it has been filled in for the first time reads as a rejection of
  // input the admin has not finished giving. `serverErrors` joins them so a
  // rejection from the API lands on the same fields, with the same words.
  const shown: DecisionErrors = showErrors
    ? { ...errors, ...serverErrors }
    : {};
  const shownRental: RentalErrors = showErrors ? rentalErrors : {};

  const set = <K extends keyof DetailDraft>(key: K, value: DetailDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const isOpen = (label: string) => openSections.includes(label);
  const setOpen = (label: string, open: boolean) =>
    setOpenSections((current) =>
      open
        ? current.includes(label)
          ? current
          : [...current, label]
        : current.filter((entry) => entry !== label),
    );

  /**
   * `PATCH /api/reservations/:id` — one endpoint, not `/approve` and `/reject`,
   * because this button has three outcomes and the third (fields edited,
   * nothing decided) no transition route could name.
   *
   * The checks below are a courtesy, not the boundary: `/api/*` sits outside the
   * middleware matcher by design, so the handler calls `requireAdmin()` itself
   * and re-runs the same rules server-side. It answers a 422 with
   * `DecisionErrors` in `error.details`, which is why a refusal from the API can
   * be painted onto the very fields this function was about to check.
   *
   * `version` is the optimistic-concurrency token this panel read when it
   * opened. A second admin who had the same request open saves against a
   * version that no longer exists and gets a 409 instead of quietly overwriting
   * the first one's decision — so that case closes the drawer, because
   * reopening refetches the state that actually won.
   */
  const save = async () => {
    if (
      !isDecisionValid(errors) ||
      costError !== undefined ||
      detailsError !== undefined ||
      rentalIncomplete
    ) {
      setShowErrors(true);
      // Open the section holding the offending field. A required field inside a
      // collapsed accordion is an error message pointing at nothing.
      if (
        errors.driverName !== undefined ||
        errors.van !== undefined ||
        rentalIncomplete
      ) {
        setOpen(DRIVER_AND_VAN, true);
      }
      if (errors.rejectionReason !== undefined) setOpen(APPROVAL, true);
      if (costError !== undefined) setOpen(COSTING, true);
      if (detailsError !== undefined) setOpen("trip", true);
      return;
    }

    // A reassign that moved neither side AND left vendor/cost alone is a
    // request the server would answer as a no-op — refused here so the admin
    // sees why instead of a success toast. A cost-only edit through this
    // mode is legitimate (see `costEditable` above) and must not trip this.
    const costMoved =
      (draft.vendor.trim() || null) !== detail.vendor ||
      parseCost(draft.cost) !== detail.costPhp;
    if (
      mode === "reassign" &&
      !driverHasMoved(detail.assignedDriver, driverInput) &&
      !vanHasMoved(detail.assignedVan, vanInput) &&
      !costMoved
    ) {
      setServerErrors({ driverName: DECISION_MESSAGES.reassignNothing });
      setShowErrors(true);
      setOpen(DRIVER_AND_VAN, true);
      return;
    }

    setSaving(true);
    setServerErrors({});
    try {
      await apiFetch(`/api/reservations/${encodeURIComponent(detail.id)}`, {
        method: "PATCH",
        body: JSON.stringify({
          version: detail.version,
          decision,
          rejectionReason,
          driver: driverInput,
          van: vanInput,
          // Null unless "trip details changed" is ticked, so an approval is
          // never recorded as an edit — a `modified` event is what flags
          // "Changed Trip Details" to the next reviewer. A reassign sends
          // `costing` instead (below): the server refuses a `trip` edit
          // alongside a reassign outright (`writeModeFor` in write.ts), since
          // an approved request's trip fields stay locked — only vendor/cost
          // may still move.
          trip: tripEditable ? tripEditOf(draft, standby) : null,
          costing: mode === "reassign" ? costingEditOf(draft) : null,
        }),
      });

      // Every save invalidates, not just a decision: gcTime's 5m default means
      // reopening this request would otherwise paint the pre-save copy first —
      // including the `version` the NEXT save would send, which would then be
      // refused as a conflict against the write that just succeeded.
      void queryClient.invalidateQueries({
        queryKey: reservationDetailKey(detail.id),
      });
      // And the list behind this drawer, because a save changes columns the
      // list renders — the driver, the van, the plate, the trip details, the
      // status. Without this the table keeps painting whatever the page was
      // server-rendered with: a row reading Approved with an empty driver,
      // beside a drawer showing that driver assigned. Fired for a field-only
      // save too (no decision), which is the case that repainted nothing at all.
      void queryClient.invalidateQueries({ queryKey: ADMIN_RESERVATIONS_KEY });

      if (decision === null) {
        toast.success(`${detail.id} updated.`);
      } else {
        onDecided({
          id: detail.id,
          status: decision === "approve" ? "Approved" : "Rejected",
          decidedBy: adminName,
        });
      }
      onClose();
    } catch (error) {
      handleSaveError(error);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveError = (error: unknown) => {
    if (!(error instanceof ApiError)) {
      toast.error("Couldn't save this decision. Try again.");
      return;
    }

    if (error.code === "VALIDATION_FAILED" && isDecisionErrors(error.details)) {
      setServerErrors(error.details);
      setShowErrors(true);
      if (
        error.details.driverName !== undefined ||
        error.details.van !== undefined
      ) {
        setOpen(DRIVER_AND_VAN, true);
      }
      if (error.details.rejectionReason !== undefined) setOpen(APPROVAL, true);
      return;
    }

    toast.error(error.message);
    // Both mean this panel is holding a version of the request that no longer
    // exists. Closing sends the admin back to a list that refetches, rather
    // than leaving them editing a stale copy.
    if (
      error.code === "VERSION_CONFLICT" ||
      error.code === "INVALID_TRANSITION"
    ) {
      onClose();
    }
  };

  return (
    // The locked fields below carry tooltips, which must be portalled into
    // this top-layer dialog rather than to `<body>`, under the backdrop.
    <TooltipPortalContainer container={dialogRef}>
      <dialog
        ref={dialogRef}
        aria-labelledby="trip-drawer-title"
        onCancel={onClose}
        className="m-0 ml-auto h-dvh max-h-none w-full max-w-[620px] overflow-y-auto bg-background backdrop:bg-[color-mix(in_srgb,var(--color-gray-1)_35%,transparent)]"
      >
        <div className="sticky top-0 z-10 flex items-center gap-4 border-b border-gray-6 bg-background px-7 py-5">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close trip details"
            className={cn(
              "flex size-10 cursor-pointer items-center justify-center rounded-pill border-0 bg-gray-5 text-gray-1 hover:bg-gray-6",
              FOCUS_RING,
            )}
          >
            <ArrowLeft aria-hidden="true" className="size-4" />
          </button>
          <h2
            id="trip-drawer-title"
            className="text-2xl font-semibold text-gray-1"
          >
            Trip Details
          </h2>
          <div className="ml-auto flex items-center gap-3">
            <StatusChip status={detail.status} />
            <span className="text-sm text-gray-2">{detail.id}</span>
          </div>
        </div>

        <div className="px-7 pb-7">
          <DrawerSection
            label={APPROVAL}
            open={isOpen(APPROVAL)}
            onToggle={(open) => setOpen(APPROVAL, open)}
          >
            <p className="text-sm text-pretty text-gray-2">
              {mode === "reassign"
                ? "Move this trip to a different driver or van. The requestor is notified by email."
                : "Approve or reject this request. The requestor is notified by email either way."}
            </p>
            {mode === "decide" && (
              <>
                <div className="flex flex-wrap gap-3">
                  {DECISIONS.map((option) => {
                    const active = decision === option;
                    return (
                      <button
                        key={option}
                        type="button"
                        aria-pressed={active}
                        onClick={() => {
                          setDecision(active ? null : option);
                          setShowErrors(false);
                        }}
                        className={cn(
                          "cursor-pointer rounded-pill border-[1.5px] px-8 py-3 text-body font-semibold transition-[filter] hover:brightness-105",
                          FOCUS_RING,
                          option === "approve"
                            ? active
                              ? "border-success bg-success text-primary-foreground"
                              : "border-success bg-background text-success"
                            : active
                              ? "border-error bg-error text-primary-foreground"
                              : "border-error bg-background text-error",
                        )}
                      >
                        {DECISION_LABELS[option]}
                      </button>
                    );
                  })}
                </div>

                {decision === "reject" && (
                  <RejectionReason
                    value={rejectionReason}
                    error={shown.rejectionReason}
                    onChange={(next) => {
                      setRejectionReason(next);
                      setShowErrors(false);
                    }}
                  />
                )}

                <label className="flex cursor-pointer items-start gap-3 text-[0.9375rem] leading-snug text-gray-1">
                  <input
                    type="checkbox"
                    checked={editable}
                    onChange={(event) => setEditable(event.target.checked)}
                    className="mt-0.5 size-[18px] flex-none cursor-pointer accent-brand"
                  />
                  <span>
                    Trip details changed — make the trip fields editable
                  </span>
                </label>
              </>
            )}

            <DrawerField
              label="Approver"
              value={adminName}
              lockedHint="Filled from your account."
            />
          </DrawerSection>

          <DrawerSection
            label="Requestor"
            open={isOpen("Requestor")}
            onToggle={(open) => setOpen("Requestor", open)}
          >
            <DrawerField
              label="Name"
              value={detail.requestor}
              lockedHint="Submitted by the requestor — not editable."
            />
            <DrawerField
              label="Mobile Number"
              value={detail.requestorMobile}
              lockedHint="Submitted by the requestor — not editable."
            />
            <DrawerField
              label="Email"
              value={detail.requestorEmail}
              lockedHint="Submitted by the requestor — not editable."
            />
          </DrawerSection>

          <DrawerSection
            label="Ride and Site"
            open={isOpen("Ride and Site")}
            onToggle={(open) => setOpen("Ride and Site", open)}
          >
            {/* Both locked regardless of the editable toggle. Changing a booking's
              ride mode rewrites which fields it has and which validations apply;
              that is a resubmission by the requestor, not an admin correction. */}
            <DrawerField
              label="Mode"
              value={RIDE_MODE_LABELS[detail.mode].title}
              lockedHint="Submitted by the requestor — not editable."
            />
            <DrawerField
              label="Site Location"
              value={detail.site}
              lockedHint="Submitted by the requestor — not editable."
            />
          </DrawerSection>

          <DrawerSection
            label={
              standby
                ? "Trip (Dedicated Standby Van)"
                : "Trip (Pickup / Drop-Off)"
            }
            open={isOpen("trip")}
            onToggle={(open) => setOpen("trip", open)}
          >
            <DrawerSelect
              label="Purpose"
              value={draft.purpose}
              options={purposeOptions}
              placeholder="Select Purpose"
              disabled={!tripEditable}
              onChange={(v) => set("purpose", v)}
            />
            <DrawerTextArea
              label="Details"
              value={draft.details}
              error={showErrors ? detailsError : undefined}
              onChange={
                tripEditable
                  ? (v) => {
                      set("details", v);
                      setShowErrors(false);
                    }
                  : undefined
              }
              lockedHint="Tick 'Trip details changed' to edit."
            />
            {standby && (
              <DrawerField
                label="Approving Tower Head"
                value={detail.towerHead ?? EM_DASH}
                lockedHint="Submitted by the requestor — not editable."
              />
            )}
            <DrawerField
              label={standby ? "Start Date" : "Pickup Date"}
              type={tripEditable ? "date" : "text"}
              value={
                tripEditable
                  ? draft.startDate
                  : (formatPlainDate(draft.startDate) ?? EM_DASH)
              }
              onChange={tripEditable ? (v) => set("startDate", v) : undefined}
              lockedHint="Tick 'Trip details changed' to edit."
            />
            <DrawerField
              label={standby ? "Start Time" : "Pickup Time"}
              type={tripEditable ? "time" : "text"}
              value={
                tripEditable
                  ? draft.startTime
                  : (formatPlainTime(draft.startTime) ?? EM_DASH)
              }
              onChange={tripEditable ? (v) => set("startTime", v) : undefined}
              lockedHint="Tick 'Trip details changed' to edit."
            />
            {standby && (
              <>
                <DrawerField
                  label="End Date"
                  type={tripEditable ? "date" : "text"}
                  value={
                    tripEditable
                      ? draft.endDate
                      : (formatPlainDate(draft.endDate) ?? EM_DASH)
                  }
                  onChange={tripEditable ? (v) => set("endDate", v) : undefined}
                  lockedHint="Tick 'Trip details changed' to edit."
                />
                <DrawerField
                  label="End Time"
                  type={tripEditable ? "time" : "text"}
                  value={
                    tripEditable
                      ? draft.endTime
                      : (formatPlainTime(draft.endTime) ?? EM_DASH)
                  }
                  onChange={tripEditable ? (v) => set("endTime", v) : undefined}
                  lockedHint="Tick 'Trip details changed' to edit."
                />
              </>
            )}
            <DrawerField
              label={standby ? "Reporting Point" : "Pickup Point"}
              value={draft.pickupPoint}
              onChange={tripEditable ? (v) => set("pickupPoint", v) : undefined}
              lockedHint="Tick 'Trip details changed' to edit."
            />
            {!standby && (
              <DrawerField
                label="Drop Off Point"
                value={draft.dropoffPoint}
                onChange={
                  tripEditable ? (v) => set("dropoffPoint", v) : undefined
                }
                lockedHint="Tick 'Trip details changed' to edit."
              />
            )}
            <DrawerReadout label={`Passengers (${detail.passengers.length})`}>
              <ul className="flex flex-col gap-1">
                {detail.passengers.map((passenger) => (
                  <li key={passenger.domainId}>
                    {passenger.name}{" "}
                    <span className="font-mono text-xs text-gray-3">
                      {passenger.domainId}
                    </span>
                  </li>
                ))}
              </ul>
            </DrawerReadout>
          </DrawerSection>

          <DrawerSection
            label={COSTING}
            open={isOpen(COSTING)}
            onToggle={(open) => setOpen(COSTING, open)}
          >
            <DrawerField
              label="Vendor"
              value={draft.vendor}
              onChange={costEditable ? (v) => set("vendor", v) : undefined}
              lockedHint={
                mode === "reassign"
                  ? undefined
                  : "Tick 'Trip details changed' to edit."
              }
            />
            <DrawerField
              label="Additional Cost (PHP)"
              value={draft.cost}
              error={showErrors ? costError : undefined}
              onChange={
                costEditable
                  ? (v) => {
                      set("cost", v);
                      setShowErrors(false);
                    }
                  : undefined
              }
              lockedHint={
                mode === "reassign"
                  ? undefined
                  : "Tick 'Trip details changed' to edit."
              }
            />
          </DrawerSection>

          <DrawerSection
            label={DRIVER_AND_VAN}
            open={isOpen(DRIVER_AND_VAN)}
            onToggle={(open) => setOpen(DRIVER_AND_VAN, open)}
          >
            <DrawerSelect
              label="Driver"
              value={draft.driverId}
              options={driverOptions}
              placeholder={
                driversQuery.isPending ? "Loading roster…" : "Not assigned yet"
              }
              disabled={driversQuery.isPending}
              error={shown.driverName}
              onChange={(v) => {
                set("driverId", v);
                setShowErrors(false);
              }}
            />
            {driversQuery.isError && (
              <p className="text-xs text-error">
                Couldn't load the driver roster. Close and reopen this request
                to try again.
              </p>
            )}
            {/* A ROSTER driver's own record, not the trip's: editable copies
              here would be discarded on save, because `reservations` stores only
              the driver's id. A RENTAL is the inverse — the typed text is the
              stored value — so that branch renders real inputs, and neither
              readout is ever shown for one. */}
            {rentalDriver ? (
              <>
                <RentalTag />
                <DrawerField
                  label="Rental Driver's Name"
                  value={draft.rentalDriverName}
                  error={shownRental.name}
                  onChange={(v) => {
                    set("rentalDriverName", v);
                    setShowErrors(false);
                  }}
                />
                <DrawerField
                  label="Rental Driver's Mobile Number"
                  value={draft.rentalDriverMobile}
                  error={shownRental.mobile}
                  onChange={(v) => {
                    set("rentalDriverMobile", v);
                    setShowErrors(false);
                  }}
                />
              </>
            ) : (
              <>
                <DrawerField
                  label="Driver's Mobile Number"
                  value={selectedDriver?.mobile ?? EM_DASH}
                  lockedHint="From the driver's roster entry."
                />
                <DrawerField
                  label="Shift"
                  value={selectedDriver?.shift ?? EM_DASH}
                  lockedHint="From the driver's roster entry."
                />
              </>
            )}

            {/* A van is assigned per trip, not owned by a driver — hence a
              second, independent select rather than fields hanging off the
              driver's row. */}
            <DrawerSelect
              label="Van"
              value={draft.vanId}
              options={vanOptions}
              placeholder={
                vansQuery.isPending ? "Loading fleet…" : "Not assigned yet"
              }
              disabled={vansQuery.isPending}
              error={shown.van}
              onChange={(v) => {
                set("vanId", v);
                setShowErrors(false);
              }}
            />
            {vansQuery.isError && (
              <p className="text-xs text-error">
                Couldn't load the van fleet. Close and reopen this request to
                try again.
              </p>
            )}
            {rentalVan ? (
              <>
                <RentalTag />
                {/* The one optional rental field: a vendor often gives no unit
                  number, and the plate is what names the vehicle. */}
                <DrawerField
                  label="Rental Van Number"
                  value={draft.rentalVanNumber}
                  placeholder="Optional"
                  onChange={(v) => set("rentalVanNumber", v)}
                />
                <DrawerField
                  label="Rental Plate"
                  value={draft.rentalPlate}
                  error={shownRental.plate}
                  onChange={(v) => {
                    set("rentalPlate", v);
                    setShowErrors(false);
                  }}
                />
                <DrawerField
                  label="Rental Car Type"
                  value={draft.rentalCarType}
                  error={shownRental.carType}
                  onChange={(v) => {
                    set("rentalCarType", v);
                    setShowErrors(false);
                  }}
                />
              </>
            ) : (
              <>
                <DrawerField
                  label="Plate"
                  value={selectedVan?.plate ?? EM_DASH}
                  lockedHint="From the van's fleet entry."
                />
                <DrawerField
                  label="Car Type"
                  value={selectedVan?.carType ?? EM_DASH}
                  lockedHint="From the van's fleet entry."
                />
              </>
            )}
          </DrawerSection>

          <div className="flex flex-wrap items-center gap-4 pt-6">
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving}
              className={BUTTON_PRIMARY}
            >
              {saving ? "Saving…" : saveLabelFor(decision, mode)}
            </button>
            <button
              type="button"
              onClick={onClose}
              className={BUTTON_SECONDARY}
            >
              Cancel
            </button>
            <span className="ml-auto text-sm text-gray-3">
              Last updated:{" "}
              {detail.updatedAt === null
                ? "never"
                : (formatInstant(new Date(detail.updatedAt)) ?? EM_DASH)}
            </span>
          </div>
        </div>
      </dialog>
    </TooltipPortalContainer>
  );
}

/** The stored driver's roster id, or "" — a rental driver has no roster row. */
function rosterDriverId(detail: ReservationDetail): string {
  return detail.assignedDriver?.source === "roster"
    ? detail.assignedDriver.id
    : "";
}

/** The stored van's fleet id, or "" — a rental van has no fleet row. */
function rosterVanId(detail: ReservationDetail): string {
  return detail.assignedVan?.source === "roster" ? detail.assignedVan.id : "";
}

/**
 * The contact details for whichever ROSTER driver is currently selected.
 *
 * Falls back to the stored assignment while the roster is still in flight, so
 * an already-assigned request does not flash em dashes before its own data
 * arrives. Once the roster lands, the selected driver's record wins — including
 * immediately after the admin picks a different one.
 *
 * The fallback checks `source` and the id, not just the id: a rental driver's
 * mobile must never reach these readouts, which say it came from a roster entry
 * the rental does not have.
 */
function rosterDriverOf(
  driverId: string,
  roster: Driver[],
  detail: ReservationDetail,
): { mobile: string; shift: string | null } | null {
  const selected = roster.find((driver) => driver.id === driverId);
  if (selected !== undefined) {
    return { mobile: selected.mobile, shift: selected.shift };
  }
  const stored = detail.assignedDriver;
  if (stored === null || stored.source !== "roster" || stored.id !== driverId) {
    return null;
  }
  return { mobile: stored.mobile, shift: stored.shift };
}

/** The same, for the fleet van — including the same rental exclusion. */
function rosterVanOf(
  vanId: string,
  fleet: Van[],
  detail: ReservationDetail,
): { plate: string; carType: string } | null {
  const selected = fleet.find((van) => van.id === vanId);
  if (selected !== undefined) {
    return { plate: selected.plate, carType: selected.carType };
  }
  const stored = detail.assignedVan;
  if (stored === null || stored.source !== "roster" || stored.id !== vanId) {
    return null;
  }
  return { plate: stored.plate, carType: stored.carType };
}

/**
 * Did this side's assignment actually move?
 *
 * Mirrors `driverMoved` / `vanMoved` in `write.ts`, and must keep mirroring
 * them: a client rule that disagrees with the server's produces a save the
 * server treats as a no-op and a success toast for nothing. Compared on
 * IDENTITY — the roster id, or the rental's name and plate — so correcting a
 * rental driver's mobile is a detail edit, not a reassignment.
 */
function driverHasMoved(
  assigned: AssignedDriver | null,
  input: DriverInput | null,
): boolean {
  if (input === null) return false;
  if (input.source === "roster") {
    return assigned?.source !== "roster" || input.driverId !== assigned.id;
  }
  return assigned?.source !== "rental" || input.name.trim() !== assigned.name;
}

function vanHasMoved(
  assigned: AssignedVan | null,
  input: VanInput | null,
): boolean {
  if (input === null) return false;
  if (input.source === "roster") {
    return assigned?.source !== "roster" || input.vanId !== assigned.id;
  }
  return assigned?.source !== "rental" || input.plate.trim() !== assigned.plate;
}

/**
 * The driver block as the `driver` half of a PATCH. `""` (nothing chosen)
 * becomes null — "leave unchanged" — so a save never clears an assignment the
 * admin did not touch.
 */
function driverInputOf(draft: DetailDraft): DriverInput | null {
  if (draft.driverId === "") return null;
  if (draft.driverId === OTHERS) {
    return {
      source: "rental",
      name: draft.rentalDriverName.trim(),
      mobile: draft.rentalDriverMobile.trim(),
    };
  }
  return { source: "roster", driverId: draft.driverId };
}

/** The mirror, for the van block. */
function vanInputOf(draft: DetailDraft): VanInput | null {
  if (draft.vanId === "") return null;
  if (draft.vanId === OTHERS) {
    return {
      source: "rental",
      // Blank is genuinely "no unit number", not a missing field.
      vanNumber: draft.rentalVanNumber.trim() || null,
      plate: draft.rentalPlate.trim(),
      carType: draft.rentalCarType.trim(),
    };
  }
  return { source: "roster", vanId: draft.vanId };
}

function blankRental(isRental: boolean, value: string): string | undefined {
  return isRental && value.trim() === "" ? RENTAL_MESSAGE : undefined;
}

/**
 * The mobile field's own rule: blank is `RENTAL_MESSAGE`, same as every other
 * rental field, but a value that is not blank yet has no digits in it (typed
 * into the wrong field, or just placeholder text) gets its own message rather
 * than sailing past this check and failing at the server with nothing to
 * point at.
 */
function rentalMobileError(
  isRental: boolean,
  value: string,
): string | undefined {
  if (!isRental) return undefined;
  if (value.trim() === "") return RENTAL_MESSAGE;
  return normalizeMobile(value) === "" ? RENTAL_MOBILE_MESSAGE : undefined;
}

/** The draft's trip fields, in the shape `PATCH` takes, filtered by mode. */
function tripEditOf(draft: DetailDraft, standby: boolean) {
  return {
    purpose: draft.purpose,
    details: draft.details,
    pickupPoint: draft.pickupPoint,
    dropoffPoint: standby ? null : draft.dropoffPoint,
    startDate: draft.startDate,
    startTime: draft.startTime,
    endDate: standby ? draft.endDate : null,
    endTime: standby ? draft.endTime : null,
    vendor: draft.vendor.trim() || null,
    // `costError` has already refused anything else by the time this runs.
    costPhp: parseCost(draft.cost) ?? null,
  };
}

/** The draft's vendor/cost alone, in the shape a reassign's `costing` takes. */
function costingEditOf(draft: DetailDraft) {
  return {
    vendor: draft.vendor.trim() || null,
    costPhp: parseCost(draft.cost) ?? null,
  };
}

/** Narrows an API error's `details`, which is `unknown` by its type. */
function isDecisionErrors(value: unknown): value is DecisionErrors {
  if (typeof value !== "object" || value === null) return false;
  const { rejectionReason, driverName, van } = value as DecisionErrors;
  return (
    (rejectionReason === undefined || typeof rejectionReason === "string") &&
    (driverName === undefined || typeof driverName === "string") &&
    (van === undefined || typeof van === "string")
  );
}

function RejectionReason({
  value,
  error,
  onChange,
}: {
  value: string;
  error: string | undefined;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label
        htmlFor="rejection-reason"
        className="mb-1.5 block text-sm text-gray-1"
      >
        Reason for rejection{" "}
        <span className="text-error" aria-hidden="true">
          *
        </span>
        <span className="sr-only">(required)</span>
      </label>
      <textarea
        id="rejection-reason"
        rows={3}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Shared with the requestor"
        aria-invalid={error !== undefined || undefined}
        aria-describedby={error === undefined ? undefined : "rejection-error"}
        className={cn(
          "w-full resize-y rounded-field border bg-background px-4 py-3 text-body focus-visible:outline-3 focus-visible:outline-offset-1 focus-visible:outline-primary",
          error === undefined ? "border-gray-4" : "border-error",
        )}
      />
      {error !== undefined && (
        <p id="rejection-error" className="mt-1.5 text-xs text-error">
          {error}
        </p>
      )}
    </div>
  );
}
