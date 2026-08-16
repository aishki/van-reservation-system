import { EM_DASH } from "@/lib/tz";
import type { ParsedChanges } from "@/modules/audit/types";

/**
 * What a logged action actually changed.
 *
 * Three cases, because `reservation_events.changes` is append-only jsonb
 * written by two generations of this code:
 *
 * - `fields` — both sides, as they were recorded at the time.
 * - `names`  — a row written before values were captured. It says so rather
 *              than pretending to a diff it does not have; the values are not
 *              recoverable, and an audit trail that invents them is worse than
 *              one that admits the gap.
 * - `none`   — nothing recorded. The remark beside it carries the row.
 */
export function ChangeList({ changes }: { changes: ParsedChanges }) {
  if (changes.kind === "none") return null;

  if (changes.kind === "names") {
    return (
      <p className="text-sm text-gray-2">
        {changes.fields.join(", ")}{" "}
        <span className="text-gray-3 italic">values not recorded</span>
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-1">
      {changes.changes.map((change) => (
        <li key={change.field} className="text-sm text-gray-2">
          <span className="font-semibold text-gray-1">{change.label}:</span>{" "}
          <Side value={change.from} /> → <Side value={change.to} />
        </li>
      ))}
    </ul>
  );
}

/** An em dash for a side that held nothing — a first assignment has no "from". */
function Side({ value }: { value: string | null }) {
  if (value === null) return <span className="text-gray-3">{EM_DASH}</span>;
  return <span>“{value}”</span>;
}
