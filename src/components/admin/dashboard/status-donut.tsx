"use client";

import { Cell, Pie, PieChart } from "recharts";
import {
  STATUS_CHART_CONFIG,
  STATUS_COLOR,
} from "@/components/admin/dashboard/chart-config";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { share } from "@/modules/reservations/admin-filters";
import {
  RESERVATION_STATUSES,
  type ReservationStatus,
} from "@/modules/reservations/types";

interface StatusDonutProps {
  counts: Record<ReservationStatus, number>;
  total: number;
}

/**
 * "Trips Breakdown by Status": a donut with the total at its centre, and a
 * legend listing each status with its count and share. Zero-count statuses are
 * dropped from the arc (an empty slice draws nothing) but kept in the legend, so
 * a status with no trips still reads as "0" rather than vanishing.
 */
export function StatusDonut({ counts, total }: StatusDonutProps) {
  const data = RESERVATION_STATUSES.map((status) => ({
    status,
    count: counts[status],
    fill: STATUS_COLOR[status],
  })).filter((slice) => slice.count > 0);

  return (
    <div className="flex flex-wrap items-center gap-8">
      <div className="relative flex-none">
        <ChartContainer
          config={STATUS_CHART_CONFIG}
          className="aspect-square h-[220px] w-[220px]"
        >
          <PieChart>
            <ChartTooltip
              content={<ChartTooltipContent nameKey="status" hideLabel />}
            />
            <Pie
              data={data}
              dataKey="count"
              nameKey="status"
              innerRadius={62}
              outerRadius={104}
              paddingAngle={2}
              strokeWidth={2}
            >
              {data.map((slice) => (
                <Cell key={slice.status} fill={slice.fill} />
              ))}
            </Pie>
          </PieChart>
        </ChartContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-body text-gray-2">Total</span>
          <span className="text-3xl font-bold text-gray-1 tabular-nums">
            {total}
          </span>
        </div>
      </div>

      <ul className="flex min-w-[220px] flex-1 flex-col gap-3.5">
        {RESERVATION_STATUSES.map((status) => (
          <li key={status} className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="size-3 flex-none rounded-full"
              style={{ background: STATUS_COLOR[status] }}
            />
            <span className="text-body text-gray-1">{status}</span>
            <span className="ml-auto text-body font-semibold text-gray-1 tabular-nums">
              {counts[status]}
            </span>
            <span className="w-14 text-right text-xs text-gray-2 tabular-nums">
              {share(counts[status], total)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
