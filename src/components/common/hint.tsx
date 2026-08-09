"use client";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface HintProps {
  /**
   * Tooltip content. A node, not a string: the calendar's block previews lay
   * out a whole trip — status chip, stops, driver — which no single string can
   * carry. Existing string call sites are unaffected.
   */
  content: React.ReactNode;
  /** Render the tooltip only while true; bare children otherwise. */
  when?: boolean;
  /**
   * Wrap the trigger in a span. Disabled elements swallow pointer events, so
   * the tooltip cannot listen on them directly; the span receives the events
   * instead, and `[&>*]:pointer-events-none` keeps the child from capturing
   * them first. Read-only inputs fire events normally — leave `wrap` off and
   * the trigger attaches to the element itself.
   */
  wrap?: boolean;
  /** Extra classes for the wrapping span (grid placement, sizing). */
  wrapClassName?: string;
  children: React.ReactElement;
}

export function Hint({
  content,
  when = true,
  wrap = false,
  wrapClassName,
  children,
}: HintProps) {
  if (!when) {
    return children;
  }

  return (
    <Tooltip>
      <TooltipTrigger
        // Base UI dismisses on trigger press and will not reopen until the
        // pointer leaves and returns. Every trigger here is inert — a read-only
        // input or a disabled button — so clicking a locked field to copy its
        // value killed the hint explaining why it is locked.
        closeOnClick={false}
        render={
          wrap ? (
            <span
              role="presentation"
              className={cn(
                "inline-flex cursor-not-allowed [&>*]:pointer-events-none",
                wrapClassName,
              )}
            >
              {children}
            </span>
          ) : (
            children
          )
        }
      />
      <TooltipContent>{content}</TooltipContent>
    </Tooltip>
  );
}
