import { cn } from "@/lib/utils";

/** The four wizard steps, in order. Step 1 happens in the hero, before this. */
export const STEP_LABELS = [
  "Choose Ride",
  "Your Details",
  "Trip Info",
  "Review",
] as const;

interface WizardStepperProps {
  /** 1-based, matching the design's "Step N of 4". */
  current: number;
}

/**
 * The four-dot progress rail.
 *
 * Rendered as an ordered list with the current step carrying `aria-current`, and
 * a visually-hidden "completed" / "current" word per step. The design conveys
 * state with colour and a tick glyph alone, which leaves a screen-reader user
 * with four unlabelled list items — the connecting rules and the fill colour
 * carry all the meaning and none of it is text.
 *
 * The connector segments are `aria-hidden`: they are the same information as the
 * step states, drawn.
 */
export function WizardStepper({ current }: WizardStepperProps) {
  return (
    <ol className="mx-auto mb-10 flex max-w-[620px] items-start">
      {STEP_LABELS.map((label, index) => {
        const step = index + 1;
        const done = step < current;
        const isCurrent = step === current;
        const isLast = step === STEP_LABELS.length;

        return (
          <li
            key={label}
            aria-current={isCurrent ? "step" : undefined}
            className="flex min-w-0 flex-1 flex-col items-center gap-2.5"
          >
            <div aria-hidden="true" className="flex w-full items-center">
              <span
                className={cn(
                  "h-0.5 flex-1",
                  index === 0
                    ? "bg-transparent"
                    : step <= current
                      ? "bg-brand"
                      : "bg-gray-4",
                )}
              />
              <span
                className={cn(
                  "flex size-7 flex-none items-center justify-center rounded-pill border-2 text-[0.8125rem] font-bold text-primary-foreground",
                  done && "border-brand bg-brand",
                  isCurrent && "border-primary bg-primary",
                  !done && !isCurrent && "border-gray-4 bg-background",
                )}
              >
                {done ? "✓" : isCurrent ? "•" : ""}
              </span>
              <span
                className={cn(
                  "h-0.5 flex-1",
                  isLast
                    ? "bg-transparent"
                    : step < current
                      ? "bg-brand"
                      : "bg-gray-4",
                )}
              />
            </div>
            <span
              className={cn(
                "text-center text-sm whitespace-nowrap",
                isCurrent ? "text-brand" : done ? "text-gray-1" : "text-gray-3",
              )}
            >
              {label}
              <span className="sr-only">
                {done ? " (completed)" : isCurrent ? " (current step)" : ""}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
