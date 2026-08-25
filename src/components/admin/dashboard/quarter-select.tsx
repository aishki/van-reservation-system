"use client";

import { Select } from "@base-ui/react/select";
import { Calendar, ChevronDown } from "lucide-react";
import { FOCUS_RING } from "@/components/admin/admin-theme";
import { cn } from "@/lib/utils";
import type { QuarterOption } from "@/modules/reservations/admin-filters";

/**
 * The dashboard's "Select Quarter" dropdown — an outlined pill that scopes
 * the dashboard to one quarter and decides which months the segmented
 * control offers. It has no clear action of its own: the segmented control's
 * "All Time" clears it.
 */
export function QuarterSelect({
  quarters,
  value,
  onChange,
}: {
  quarters: QuarterOption[];
  value: string | null;
  onChange: (value: string | null) => void;
}) {
  return (
    <Select.Root
      value={value}
      onValueChange={(next: string | null) => onChange(next)}
      disabled={quarters.length === 0}
    >
      <Select.Trigger
        className={cn(
          "flex cursor-pointer items-center gap-2.5 rounded-pill border border-gray-4 bg-background px-6 py-3 text-body whitespace-nowrap text-gray-1 transition-colors hover:border-primary disabled:cursor-not-allowed disabled:opacity-60",
          FOCUS_RING,
        )}
      >
        <Calendar aria-hidden="true" className="size-4.5 text-gray-2" />
        <Select.Value>
          {(current: string | null) =>
            current === null ? (
              <span className="text-gray-2">Select Quarter</span>
            ) : (
              (quarters.find((option) => option.value === current)?.label ??
              current)
            )
          }
        </Select.Value>
        <ChevronDown aria-hidden="true" className="size-4 text-gray-2" />
      </Select.Trigger>
      <Select.Portal>
        <Select.Positioner
          alignItemWithTrigger={false}
          sideOffset={6}
          className="z-50 outline-none"
        >
          <Select.Popup className="min-w-[var(--anchor-width)] rounded-field border border-gray-6 bg-background py-1.5 shadow-lg">
            {quarters.map((option) => (
              <Select.Item
                key={option.value}
                value={option.value}
                className="cursor-pointer px-5 py-2.5 text-body text-gray-1 outline-none data-highlighted:bg-gray-5 data-selected:font-semibold"
              >
                <Select.ItemText>{option.label}</Select.ItemText>
              </Select.Item>
            ))}
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  );
}
