import { z } from "zod";
import { ADMIN_SITES } from "@/modules/auth/roles";
import { SITE_LOCATIONS } from "@/modules/reservations/types";
import { ROSTER_MESSAGES } from "@/modules/roster/types";

/**
 * The roster payloads, parsed.
 *
 * Two site vocabularies live here and must not be conflated. Drivers and vans
 * use `SITE_LOCATIONS` — title-case `Iloilo` / `Manila`, mapped to lower case by
 * `SITE_TO_DB` on the way to a column whose CHECK admits exactly those two.
 * Admins use `ADMIN_SITES`, which is ALREADY lower case and additionally admits
 * `all`, because an admin's site routes notifications rather than naming a
 * place. Accepting `all` for a van would fail its CHECK at the database.
 */

/** Postgres unique-violation SQLSTATE. */
export const UNIQUE_VIOLATION = "23505";

const text = z.string().trim().min(1);

export const driverCreateSchema = z.object({
  name: text,
  mobile: text,
  site: z.enum(SITE_LOCATIONS),
  // Free text and nullable: Iloilo's drivers have no shift, Manila's are
  // "11AM-11PM" / "11PM-11AM". Not a closed vocabulary — see drivers/types.ts.
  shift: text.nullable().default(null),
});
export type DriverCreate = z.infer<typeof driverCreateSchema>;

/**
 * `.partial()` then a non-empty check: a PATCH carries only what moved, but an
 * EMPTY patch would write nothing while still logging an `updated` event — a
 * trail entry for a change that never happened. The `.extend()` drops
 * `.default(null)` from `shift` — a PATCH must not be looser than a POST, so
 * `text` validators (trim, min(1)) must stay.
 */
export const driverPatchSchema = driverCreateSchema
  .partial()
  .extend({
    shift: text.nullable().optional(),
  })
  // Unknown keys are REJECTED, not stripped. A body carrying both `active` and
  // a field would otherwise apply one half and silently drop the other, and a
  // misspelled field name would report a successful save that changed nothing.
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Nothing to change.",
  });
export type DriverPatch = z.infer<typeof driverPatchSchema>;

/**
 * Activation is its own request shape, not a patchable field.
 *
 * `set*Active` logs `deactivated`/`reactivated` — "who took this driver off the
 * roster" is what the log is most often asked — whereas `update*` logs
 * `updated` over a field diff that deliberately excludes `active`. Letting one
 * request carry both meant the row could change state under an event that
 * described something else entirely.
 */
export const activeSchema = z.object({ active: z.boolean() }).strict();

export const vanCreateSchema = z.object({
  vanNumber: text,
  plate: text,
  carType: text,
  site: z.enum(SITE_LOCATIONS),
});
export type VanCreate = z.infer<typeof vanCreateSchema>;

export const vanPatchSchema = vanCreateSchema
  .partial()
  // Unknown keys are REJECTED, not stripped — see `driverPatchSchema`.
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Nothing to change.",
  });
export type VanPatch = z.infer<typeof vanPatchSchema>;

const adminFields = z.object({
  fullName: text,
  // Lower-cased to match `admin_whitelist_email_lower_trim_idx`. Storing the
  // supplied case would risk a second row for the same person differing only by
  // capitals — the same reason the seed lower-cases.
  email: text.toLowerCase().nullable().default(null),
  // NOT case-folded. `admin_whitelist_domain_id_idx` is a plain unique index and
  // `matchWhitelist` compares Domain IDs verbatim; folding here without a paired
  // migration to `unique (lower(domain_id))` would break the login match.
  domainId: text.nullable().default(null),
  site: z.enum(ADMIN_SITES),
  notify: z.boolean().default(true),
  superAdmin: z.boolean().default(false),
});

/** Mirrors `admin_whitelist_identity_check`: an email OR a Domain ID. */
const hasIdentity = (value: {
  email: string | null;
  domainId: string | null;
}) => value.email !== null || value.domainId !== null;

/** One copy of the string: the repo returns it for the merged-patch case too. */
const IDENTITY_MESSAGE = ROSTER_MESSAGES.identityRequired;

export const adminCreateSchema = adminFields.refine(hasIdentity, {
  message: IDENTITY_MESSAGE,
  path: ["email"],
});
export type AdminCreate = z.infer<typeof adminCreateSchema>;

/**
 * `.partial()` then a non-empty check: a PATCH carries only what moved, but an
 * EMPTY patch would write nothing while still logging an `updated` event — a
 * trail entry for a change that never happened. The `.extend()` drops defaults
 * from email, domainId, notify, superAdmin — a PATCH must not be looser than
 * a POST, so `text` validators (trim, min(1)) must stay on email and domainId.
 *
 * `active` is deliberately ABSENT, as it is from the driver and van patches:
 * `ADMIN_FIELDS` omits it, so `diffFields` never sees it, yet a patch carrying
 * it would still flip the row — a state change under an `updated` event that
 * described only the other fields. `activeSchema` and `setAdminActive` own
 * activation, and log `deactivated`/`reactivated`.
 */
export const adminPatchSchema = adminFields
  .partial()
  .extend({
    email: text.toLowerCase().nullable().optional(),
    domainId: text.nullable().optional(),
    notify: z.boolean().optional(),
    superAdmin: z.boolean().optional(),
  })
  // Unknown keys are REJECTED, not stripped — see `driverPatchSchema`.
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Nothing to change.",
  });
export type AdminPatch = z.infer<typeof adminPatchSchema>;

/**
 * Which input a unique violation belongs to.
 *
 * Detected by CATCHING the violation rather than by a pre-flight `select`,
 * which races: two concurrent creates both see the plate free, and one then
 * fails anyway. The database is the only authority on uniqueness.
 *
 * Returns `null` for an unmapped constraint so the caller surfaces a real error
 * instead of blaming an arbitrary field.
 */
const CONSTRAINT_FIELDS: Record<string, string> = {
  vans_van_number_key: "vanNumber",
  vans_plate_key: "plate",
  admin_whitelist_email_lower_trim_idx: "email",
  admin_whitelist_domain_id_idx: "domainId",
};

export function fieldForConstraint(message: string): string | null {
  for (const [constraint, field] of Object.entries(CONSTRAINT_FIELDS)) {
    if (message.includes(constraint)) return field;
  }
  return null;
}
