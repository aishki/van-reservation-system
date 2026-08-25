import type { ChartConfig } from "@/components/ui/chart";
import {
  RESERVATION_STATUSES,
  type ReservationStatus,
} from "@/modules/reservations/types";

/**
 * Status colours reuse the app's status vocabulary — the same tokens
 * `StatusChip` uses — rather than the design's arbitrary chart hues, so the
 * donut, the trend lines, and the chips all agree on what "Approved" looks like.
 */
export const STATUS_COLOR: Record<ReservationStatus, string> = {
  Pending: "var(--color-brand)",
  Approved: "var(--color-success)",
  "Approved - Driver Reassigned":
    "color-mix(in srgb, var(--color-success) 55%, white)",
  Rejected: "var(--color-error)",
  Cancelled: "var(--color-gray-3)",
};

export const STATUS_CHART_CONFIG: ChartConfig = Object.fromEntries(
  RESERVATION_STATUSES.map((status) => [
    status,
    { label: status, color: STATUS_COLOR[status] },
  ]),
);
