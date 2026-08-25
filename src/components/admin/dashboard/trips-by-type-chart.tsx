"use client";

import { Bar, BarChart, Cell, LabelList, XAxis, YAxis } from "recharts";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import type { TypeSlice } from "@/modules/reservations/dashboard-metrics";

const TYPE_CONFIG: ChartConfig = {
  count: { label: "Trips" },
  pickup: { label: "Pickup / Drop-Off", color: "var(--color-brand)" },
  standby: { label: "Standby Van", color: "var(--color-primary)" },
};

/** "Trips by Type": a horizontal bar per ride mode, labelled with its count. */
export function TripsByTypeChart({ data }: { data: TypeSlice[] }) {
  const chartData = data.map((slice) => ({
    ...slice,
    fill: `var(--color-${slice.mode})`,
  }));

  return (
    <ChartContainer config={TYPE_CONFIG} className="h-[160px] w-full">
      <BarChart
        data={chartData}
        layout="vertical"
        margin={{ left: 8, right: 40, top: 4, bottom: 4 }}
      >
        <XAxis type="number" dataKey="count" hide />
        <YAxis
          type="category"
          dataKey="label"
          tickLine={false}
          axisLine={false}
          width={140}
        />
        <ChartTooltip
          cursor={false}
          content={<ChartTooltipContent nameKey="label" />}
        />
        <Bar dataKey="count" radius={7} barSize={26}>
          {chartData.map((slice) => (
            <Cell key={slice.mode} fill={slice.fill} />
          ))}
          <LabelList
            dataKey="count"
            position="right"
            className="fill-gray-1 text-sm font-semibold tabular-nums"
          />
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}
