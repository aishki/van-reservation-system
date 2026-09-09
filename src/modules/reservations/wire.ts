import { z } from "zod";
import { DECISIONS } from "@/modules/reservations/decision";
import {
  type DriverInput,
  RIDE_MODES,
  SITE_LOCATIONS,
  type VanInput,
} from "@/modules/reservations/types";

/**
 * The shapes the three write endpoints accept off the wire.
 *
 * Structural parsing only — these schemas answer "is this the right shape?",
 * never "are these values acceptable?". The business rules live in `draft.ts`
 * and `decision.ts` and run afterwards, on a parsed object, because they return
 * per-field messages the forms paint onto their inputs. A zod issue list would
 * reach those same forms as a shape error nobody can act on.
 *
 * That split is why `site` admits `""` here: it is the wizard's "not chosen
 * yet" value, and letting it through means the requestor gets
 * `MESSAGES.siteRequired` on the site field rather than a 422 about an invalid
 * enum.
 */

/**
 * Caps on the two unbounded arrays. The wizard imposes neither, so without
 * these one request could ask the server to insert an arbitrary number of rows
 * inside a single transaction. Both sit far above any real booking (the design's
 * van seats 14) so no legitimate submission meets them.
 */
export const MAX_TRIPS_PER_SUBMISSION = 10;
export const MAX_PASSENGERS_PER_TRIP = 20;

const passengerSchema = z.object({
  domainId: z.string(),
  name: z.string(),
});

const tripSchema = z.object({
  purpose: z.string(),
  details: z.string(),
  towerHead: z.string(),
  passengers: z.array(passengerSchema).min(1).max(MAX_PASSENGERS_PER_TRIP),
  pickupDate: z.string(),
  pickupTime: z.string(),
  dropoffPoint: z.string(),
  pickupPoint: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  startTime: z.string(),
  endTime: z.string(),
});

export const bookingDraftSchema = z.object({
  mode: z.enum(RIDE_MODES),
  site: z.union([z.enum(SITE_LOCATIONS), z.literal("")]),
  mobile: z.string(),
  trips: z.array(tripSchema).min(1).max(MAX_TRIPS_PER_SUBMISSION),
});

/**
 * The two sides of an assignment, each roster-or-rental, discriminated by
 * `source`. `satisfies` pins them to the contract `types.ts` declares, so a
 * schema that drifts from `DriverInput` / `VanInput` fails to compile here
 * rather than at the route's call site.
 *
 * `min(1)` on the rental fields is the same kind of check as `uuid()` on a
 * roster id, not a business rule: a rental whose plate is `""` identifies
 * nothing, and the assignment mail refuses an empty field outright.
 */
const driverInputSchema = z.discriminatedUnion("source", [
  z.object({ source: z.literal("roster"), driverId: z.uuid() }),
  z.object({
    source: z.literal("rental"),
    name: z.string().min(1),
    mobile: z.string().min(1),
  }),
]) satisfies z.ZodType<DriverInput>;

const vanInputSchema = z.discriminatedUnion("source", [
  z.object({ source: z.literal("roster"), vanId: z.uuid() }),
  z.object({
    source: z.literal("rental"),
    vanNumber: z.string().nullable().default(null),
    plate: z.string().min(1),
    carType: z.string().min(1),
  }),
]) satisfies z.ZodType<VanInput>;

/**
 * The admin drawer's save. `version` is the row version the drawer read when it
 * opened; the update refuses to apply against any other, so two admins
 * reviewing one request cannot both win (see `decideReservation`).
 *
 * `trip` is null when the admin only decided — the drawer keeps trip fields
 * locked until "trip details changed" is ticked, and sending them unchanged
 * would make every approval look like an edit.
 *
 * `driver` and `van` default to null, which means "leave that side unchanged" —
 * so a save that assigns a van says nothing about the driver.
 */
export const decisionInputSchema = z.object({
  version: z.int().nonnegative(),
  decision: z.enum(DECISIONS).nullable(),
  rejectionReason: z.string().default(""),
  driver: driverInputSchema.nullable().default(null),
  van: vanInputSchema.nullable().default(null),
  trip: z
    .object({
      purpose: z.string(),
      details: z.string(),
      pickupPoint: z.string(),
      dropoffPoint: z.string().nullable().default(null),
      startDate: z.string(),
      startTime: z.string(),
      endDate: z.string().nullable().default(null),
      endTime: z.string().nullable().default(null),
      vendor: z.string().nullable().default(null),
      costPhp: z.number().int().nullable().default(null),
    })
    .nullable()
    .default(null),
  /**
   * Vendor/cost on their own — the one edit a reassign may carry alongside
   * `trip: null`. See `CostingEdit` in write.ts.
   */
  costing: z
    .object({
      vendor: z.string().nullable().default(null),
      costPhp: z.number().int().nullable().default(null),
    })
    .nullable()
    .default(null),
});

/** A requestor's cancellation. The reason is optional; the schema requires one. */
export const cancelInputSchema = z.object({
  reason: z.string().default(""),
});

/**
 * Reads and parses a JSON body, folding a malformed body and a wrong-shaped one
 * into the same `null`. Both are the same thing to a caller: a request this
 * endpoint cannot act on, answered with one 422 rather than leaking zod's issue
 * tree to a client that has no use for it.
 */
export async function parseJsonBody<T>(
  req: Request,
  schema: z.ZodType<T>,
): Promise<T | null> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return null;
  }
  const parsed = schema.safeParse(body);
  return parsed.success ? parsed.data : null;
}
