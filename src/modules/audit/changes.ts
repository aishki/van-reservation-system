import type { FieldChange, ParsedChanges } from "@/modules/audit/types";

/**
 * `reservation_events.changes` is jsonb written by two different generations of
 * this code, and it is append-only — the old rows cannot be migrated because
 * the values they omit were never captured. Discriminates on the element type
 * rather than on a version field, because the old rows carry no version.
 *
 * Total: every malformed input answers `none`. A log viewer that throws on one
 * bad row shows nothing at all, which is the worse failure for an audit trail.
 */
export function parseChanges(raw: unknown): ParsedChanges {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { kind: "none" };
  }
  const fields = (raw as { fields?: unknown }).fields;
  if (!Array.isArray(fields) || fields.length === 0) return { kind: "none" };

  // The element type IS the discriminator: the legacy shape is an array of
  // names, the current one an array of objects.
  if (fields.every((entry) => typeof entry === "string")) {
    return { kind: "names", fields: fields as string[] };
  }

  const changes = fields.filter(isFieldChange);
  return changes.length === 0 ? { kind: "none" } : { kind: "fields", changes };
}

/** `from` and `to` are nullable — a first assignment legitimately has no from. */
function isFieldChange(value: unknown): value is FieldChange {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.field === "string" &&
    typeof entry.label === "string" &&
    (entry.from === null || typeof entry.from === "string") &&
    (entry.to === null || typeof entry.to === "string")
  );
}
