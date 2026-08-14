"use client";

import { useRef, useState } from "react";
import { Hint } from "@/components/common/hint";
import { useDismissable } from "@/hooks/use-dismissable";
import { cn } from "@/lib/utils";

export interface RowAction {
  label: string;
  enabled: boolean;
  /** Tooltip shown on the item while it is disabled. */
  disabledReason?: string;
  onSelect: () => void;
}

interface RowMenuProps {
  /** Reference of the booking this menu acts on, for the accessible name. */
  reference: string;
  actions: RowAction[];
}

/**
 * The per-row "⋮" actions menu, shared by the requestor's bookings table and the
 * admin master list.
 *
 * One glyph for both. The design draws "⋮" on the requestor table and "⋯" on the
 * admin one; two spellings of the same affordance is drift, like the four
 * spellings of the pickup mode, so the vertical form is canonical here.
 *
 * Disabled items stay in the menu rather than being hidden, which is the design's
 * choice and the right one: "Edit request" vanishing once a booking is approved
 * looks like a missing feature, whereas a greyed row communicates that the
 * booking has moved on. They are real `disabled` buttons, so they are announced
 * as unavailable instead of merely looking grey.
 *
 * Focus returns to the trigger on close, so dismissing with Escape does not drop
 * the user back to the top of a ten-column table.
 */
export function RowMenu({ reference, actions }: RowMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };
  useDismissable(open, rootRef, close);

  return (
    <div ref={rootRef} className="relative flex justify-end">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Actions for ${reference}`}
        onClick={() => setOpen((current) => !current)}
        className={cn(
          "size-9 cursor-pointer rounded-pill border-0 text-lg leading-none text-gray-1 hover:bg-gray-6 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-primary",
          open ? "bg-gray-6" : "bg-transparent",
        )}
      >
        ⋮
      </button>

      {open && (
        <div
          role="menu"
          aria-label={`Actions for ${reference}`}
          className="absolute top-11 right-0 z-30 w-[210px] animate-in fade-in slide-in-from-top-1 rounded-field border border-gray-6 bg-popover py-1.5 shadow-[0_14px_34px_color-mix(in_srgb,var(--color-navy)_16%,transparent)] duration-100"
        >
          {actions.map((action) => (
            <Hint
              key={action.label}
              content={action.disabledReason ?? ""}
              when={!action.enabled && action.disabledReason !== undefined}
              wrap
              wrapClassName="block w-full"
            >
              <button
                type="button"
                role="menuitem"
                disabled={!action.enabled}
                onClick={() => {
                  setOpen(false);
                  action.onSelect();
                }}
                className={cn(
                  "block w-full bg-transparent px-[18px] py-3 text-left text-[0.9375rem] hover:bg-gray-5 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary",
                  action.enabled
                    ? "cursor-pointer text-gray-1"
                    : "cursor-not-allowed text-gray-3 hover:bg-transparent",
                )}
              >
                {action.label}
              </button>
            </Hint>
          ))}
        </div>
      )}
    </div>
  );
}
