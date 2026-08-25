"use client";

import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import {
  STATUS_CHART_CONFIG,
  STATUS_COLOR,
} from "@/components/admin/dashboard/chart-config";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import type { TrendPoint } from "@/modules/reservations/dashboard-metrics";
import { RESERVATION_STATUSES } from "@/modules/reservations/types";

/** "Trips Trend": monthly counts per status, one line each, over the range. */
export function TripsTrendChart({ data }: { data: TrendPoint[] }) {
  return (
    <ChartContainer config={STATUS_CHART_CONFIG} className="h-[260px] w-full">
      <LineChart data={data} margin={{ left: 4, right: 12, top: 8 }}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={24}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={28}
          allowDecimals={false}
        />
        <ChartTooltip content={<ChartTooltipContent />} />
        <ChartLegend content={<ChartLegendContent />} />
        {RESERVATION_STATUSES.map((status) => (
          <Line
            key={status}
            dataKey={status}
            type="monotone"
            stroke={STATUS_COLOR[status]}
            strokeWidth={2}
            dot={false}
          />
        ))}
      </LineChart>
    </ChartContainer>
  );
}
