import { z } from "zod";
import { MAX_AUDIT_LIMIT } from "@/modules/audit/repo";
import { AUDIT_ACTIONS } from "@/modules/audit/types";
import { ROSTER_EVENT_TYPES } from "@/modules/roster/types";

/**
 * The audit log's query string, parsed.
 *
 * Every field is optional: a bare `GET /api/audit-logs` is the newest page of
 * everything, which is what the page loads with.
 *
 * `cursor` is one opaque parameter rather than two, so a client cannot send a
 * timestamp and an id that never appeared together — a mismatched pair silently
 * skips rows instead of failing.
 */
const PLAIN_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** `<iso instant>|<uuid>`. Opaque to the client; this is the only reader. */
const CURSOR = /^(.+)\|([0-9a-f-]{36})$/;

/** Which log to read. Two logs, one page — see `audit-view.tsx`. */
export const AUDIT_SOURCES = ["reservations", "roster"] as const;
export type AuditSource = (typeof AUDIT_SOURCES)[number];

const cursorSchema = z
  .string()
  .regex(CURSOR)
  .nullable()
  .default(null)
  .transform((raw) => {
    if (raw === null) return null;
    const match = CURSOR.exec(raw);
    if (match === null) return null;
    const at = new Date(match[1]);
    // A cursor whose instant does not parse would become `Invalid Date` in
    // the query and silently match nothing.
    if (Number.isNaN(at.getTime())) return null;
    return { at: match[1], id: match[2] };
  });

/** Filters both logs share. */
const sharedQueryFields = {
  actor: z.string().trim().min(1).nullable().default(null),
  from: z.string().regex(PLAIN_DATE).nullable().default(null),
  to: z.string().regex(PLAIN_DATE).nullable().default(null),
  limit: z.coerce.number().int().min(1).max(MAX_AUDIT_LIMIT).default(50),
  cursor: cursorSchema,
};

/**
 * Two schemas, not one union with fields meaningless on one side: the
 * reservation log's `action` filter is over `AUDIT_ACTIONS`, the roster log's
 * `eventType` filter is over `ROSTER_EVENT_TYPES` — different vocabularies,
 * different query parameters.
 */
const reservationQuerySchema = z.object({
  source: z.literal("reservations"),
  action: z.enum(AUDIT_ACTIONS).nullable().default(null),
  ...sharedQueryFields,
});

const rosterQuerySchema = z.object({
  source: z.literal("roster"),
  eventType: z.enum(ROSTER_EVENT_TYPES).nullable().default(null),
  ...sharedQueryFields,
});

export const auditQuerySchema = z.discriminatedUnion("source", [
  reservationQuerySchema,
  rosterQuerySchema,
]);

export type AuditQueryInput = z.infer<typeof auditQuerySchema>;

/** The cursor a client sends back to ask for the next page. */
export function encodeCursor(cursor: { at: string; id: string }): string {
  return `${cursor.at}|${cursor.id}`;
}

/**
 * `URLSearchParams` → the schema's input. An absent parameter is `null`, not
 * `undefined`, so `.default(null)` is what fills it in — `searchParams.get`
 * already answers `null`, and translating that to `undefined` would only make
 * the two spellings differ for no reason.
 *
 * `source` defaults to `"reservations"` here, not in the schema: the
 * discriminant of a `discriminatedUnion` must be a literal, and a bare
 * request with no `source` at all is the existing behavior everyone already
 * depends on.
 */
export function auditQueryFrom(params: URLSearchParams): unknown {
  return {
    source: params.get("source") === "roster" ? "roster" : "reservations",
    action: params.get("action"),
    eventType: params.get("eventType"),
    actor: params.get("actor"),
    from: params.get("from"),
    to: params.get("to"),
    limit: params.get("limit") ?? undefined,
    cursor: params.get("cursor"),
  };
}
