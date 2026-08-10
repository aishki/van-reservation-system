import Link from "next/link";
import { MONO_LABEL } from "@/components/requestor/requestor-theme";
import { RIDE_MODE_LABELS, type RideMode } from "@/modules/reservations/types";

/**
 * Step 1 of the booking flow. Descriptions are the design's copy verbatim; the
 * titles come from the shared label map so the wizard's own headings cannot
 * drift from what was picked here.
 */
const RIDE_DESCRIPTIONS: Record<RideMode, string> = {
  pickup:
    "A single point-to-point trip with a set pickup time, pickup point, and drop-off point.",
  standby:
    "A van and driver held on call for a block of time. Dedicated to your request and charged to your Tower Head.",
};

interface HeroRidePickerProps {
  /** Returns to the resting hero copy, reversing the choreography. */
  onBack: () => void;
  /** See `HeroCopy` — the root carries the ref so the stagger has real children. */
  ref?: React.Ref<HTMLDivElement>;
}

/**
 * The ride picker, rendered inside the hero rather than on its own route.
 *
 * That placement is the design's, and it has a real consequence: this state is
 * NOT deep-linkable from within the page's own navigation, because it is React
 * state, not a location. `/?view=choose` is honoured on first load so the
 * header's "Book" item can reach it from another route — but toggling in place
 * does not push history, so the browser's Back button leaves the page instead
 * of returning to the resting hero. That is the cost of the drive-by
 * choreography, which cannot sequence across a route transition; the in-page
 * "Back" control below exists to cover it.
 */
export function HeroRidePicker({ onBack, ref }: HeroRidePickerProps) {
  return (
    <div ref={ref} className="max-w-full md:max-w-[760px]">
      <div className="mb-[18px] flex items-center gap-3.5">
        <button
          type="button"
          onClick={onBack}
          className={`${MONO_LABEL} inline-flex cursor-pointer items-center gap-2 text-white/72 transition-colors hover:text-white`}
        >
          <span aria-hidden="true">←</span> Back
        </button>
        <span
          aria-hidden="true"
          className="h-px w-6 flex-none bg-white/35 md:w-16"
        />
        <span className={`${MONO_LABEL} whitespace-nowrap text-white/72`}>
          Step 1 of 4 · Choose ride
        </span>
      </div>

      <h2 className="mb-[26px] text-[2.25rem] leading-[1.02] font-medium tracking-[-0.045em] text-white md:text-[3.75rem]">
        What do you need?
      </h2>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {(Object.keys(RIDE_DESCRIPTIONS) as RideMode[]).map((mode) => (
          <Link
            key={mode}
            href={`/book?mode=${mode}`}
            className="block cursor-pointer rounded-card border border-white/30 bg-white/8 px-[26px] py-6 text-left backdrop-blur-[6px] transition-[background-color,border-color,transform] duration-150 hover:-translate-y-0.5 hover:border-white hover:bg-white/16 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-white/80"
          >
            <span className="flex items-center gap-3">
              <span className="text-[1.375rem] leading-[1.3] font-medium tracking-[-0.025em] text-white">
                {RIDE_MODE_LABELS[mode].title}
              </span>
              <span aria-hidden="true" className="ml-auto text-xl text-white">
                ›
              </span>
            </span>
            <span className="mt-2.5 block text-[0.9375rem] leading-[1.45rem] text-pretty text-white/78">
              {RIDE_DESCRIPTIONS[mode]}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
