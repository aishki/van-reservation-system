import { cn } from "@/lib/utils";
import type { ReservationStatus } from "@/modules/reservations/types";

/**
 * Status pill.
 *
 * Every pairing is a token-backed tint with its matching foreground, and each
 * clears WCAG AA for normal text on its own surface — these are 14px, so 3:1 is
 * not enough. `Cancelled` uses gray-2 on gray-5 rather than gray-3, which at
 * 3.03:1 on white would fail outright.
 *
 * Colour is never the only signal: the status word itself is the content, so the
 * chip still reads correctly in monochrome or to a screen reader.
 */
const CHIP: Record<ReservationStatus, string> = {
  Pending: "bg-brand-tint text-brand",
  Approved: "bg-success-tint text-success",
  // The trip IS approved; a fourth colour would imply a different kind of
  // state. The label carries the distinction.
  "Approved - Driver Reassigned": "bg-success-tint text-success",
  Rejected: "bg-error-tint text-error",
  Cancelled: "bg-gray-5 text-gray-2",
};

export function StatusChip({ status }: { status: ReservationStatus }) {
  return (
    <span
      className={cn(
        "inline-block rounded-pill px-3.5 py-1.5 text-sm font-semibold",
        CHIP[status],
      )}
    >
      {status}
    </span>
  );
}
