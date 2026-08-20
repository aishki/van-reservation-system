import { z } from "zod";
import { err, ok, type Result } from "@/lib/result";
import { EM_DASH } from "@/lib/tz";
import {
  type AdminNewRequestInput,
  renderAdminNewRequest,
} from "@/modules/email/templates/admin-new-request";
import {
  type BookingStatusChangeInput,
  renderBookingStatusChange,
} from "@/modules/email/templates/booking-status-change";
import {
  type BookingSubmittedInput,
  renderBookingSubmitted,
} from "@/modules/email/templates/booking-submitted";
import {
  type DriverAssignmentInput,
  renderDriverAssignment,
} from "@/modules/email/templates/driver-assignment";
import type { EmailBody } from "@/modules/email/transport";

/**
 * The dispatcher's lookup: template name → schema + renderer.
 *
 * An outbox row's `payload` is jsonb, so it reaches us as `unknown`. Validating
 * it HERE turns a shape mismatch into a permanent, visible failure on the row —
 * rather than a renderer throwing on `undefined.map`, or worse, rendering an
 * empty string that `sendEmail` then refuses as `VALIDATION_FAILED` with nothing
 * saying which field was missing.
 *
 * Every string is `min(1)` for that second reason: an empty field is not a
 * cosmetic problem, it is a message that cannot be sent.
 */
const text = z.string().min(1);

// `details` became required after this branch's `reservations.details`
// migration. An outbox row queued before that deploy — e.g. one awaiting a
// backoff retry — has no such field, and INVALID_PAYLOAD is permanent
// (`dispatch.ts` marks the row `failed`), so a plain `text` here would strand
// it forever. Tolerate a missing/blank value for one release; tighten back to
// `text` once no pre-deploy row can remain in the outbox.
const tripDetails = text.catch(EM_DASH);

const passenger = z.object({ name: text, domainId: text });

/**
 * Absent until Admin Support assigns a van. `carType` is additionally
 * `.optional()` on its own: it was added to this payload after some
 * `notification_outbox` rows were already queued, and INVALID_PAYLOAD is
 * permanent — a stricter field here would strand those rows the same way
 * `tripDetails` above would. Tighten once no pre-deploy row can remain.
 */
const driver = z
  .object({ name: text, mobile: text, plate: text, carType: text.optional() })
  .optional();

const trip = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("pickup"),
    referenceId: text,
    purpose: text,
    details: tripDetails,
    pickup: text,
    pickupPoint: text,
    dropoffPoint: text,
    passengers: z.array(passenger),
    driver,
  }),
  z.object({
    mode: z.literal("standby"),
    referenceId: text,
    purpose: text,
    details: tripDetails,
    towerHead: text,
    window: text,
    hours: text,
    reportingPoint: text,
    passengers: z.array(passenger),
    driver,
  }),
]);

const requestInformation = z.object({
  site: text,
  rideMode: text,
  requestor: z.object({ name: text, email: text, mobile: text }),
  trips: z.array(trip).min(1),
});

const withManageUrl = requestInformation.extend({ manageUrl: text });

interface TemplateEntry<T> {
  schema: z.ZodType<T>;
  render: (input: T) => Promise<EmailBody>;
}

/** Pairs a schema with the renderer it validates for, preserving both types. */
function entry<T>(
  schema: z.ZodType<T>,
  render: (input: T) => Promise<EmailBody>,
): TemplateEntry<T> {
  return { schema, render };
}

// biome-ignore lint/suspicious/noExplicitAny: each entry is internally typed by `entry`; the map itself is heterogeneous by nature
const TEMPLATES: Record<string, TemplateEntry<any>> = {
  "booking-submitted": entry(
    withManageUrl as z.ZodType<BookingSubmittedInput>,
    renderBookingSubmitted,
  ),
  "admin-new-request": entry(
    requestInformation.extend({
      adminUrl: text,
    }) as z.ZodType<AdminNewRequestInput>,
    renderAdminNewRequest,
  ),
  // One schema per STATUS, unioned — so a Rejected payload with no reason, or a
  // Cancelled one with no canceller, is refused here instead of rendering a
  // blank block that reads as a bug to whoever receives it.
  "booking-status-change": entry(
    z.discriminatedUnion("status", [
      withManageUrl.extend({ status: z.literal("Approved") }),
      withManageUrl.extend({
        status: z.literal("Rejected"),
        rejectionReason: text,
      }),
      withManageUrl.extend({
        status: z.literal("Cancelled"),
        cancelledBy: z.enum(["associate", "admin_support"]),
        cancellationReason: text,
      }),
    ]) as unknown as z.ZodType<BookingStatusChangeInput>,
    renderBookingStatusChange,
  ),
  "driver-assignment": entry(
    withManageUrl.extend({
      change: z.enum(["assigned", "changed"]),
    }) as z.ZodType<DriverAssignmentInput>,
    renderDriverAssignment,
  ),
};

/** Both failures are PERMANENT: retrying either replays a programming error. */
export type RenderFailure = "UNKNOWN_TEMPLATE" | "INVALID_PAYLOAD";

export async function renderTemplate(
  name: string,
  payload: unknown,
): Promise<Result<EmailBody, RenderFailure>> {
  const template = TEMPLATES[name];
  if (template === undefined) return err("UNKNOWN_TEMPLATE");

  const parsed = template.schema.safeParse(payload);
  if (!parsed.success) return err("INVALID_PAYLOAD");

  return ok(await template.render(parsed.data));
}
