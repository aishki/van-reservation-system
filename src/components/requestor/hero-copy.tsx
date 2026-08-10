import Link from "next/link";
import {
  HERO_CTA_GHOST,
  HERO_CTA_PRIMARY,
  HERO_DISPLAY_LINE,
  MONO_LABEL,
} from "@/components/requestor/requestor-theme";
import { SITE_LOCATIONS } from "@/modules/reservations/types";

interface HeroCopyProps {
  /** Opens the ride picker in place, running the drive-by choreography. */
  onBookTrip: () => void;
  /**
   * Attached to the root, not a wrapper. The swap animation staggers this
   * block's direct children (eyebrow, headline, CTA row), so an extra wrapping
   * element would collapse the stagger to a single target.
   */
  ref?: React.Ref<HTMLDivElement>;
}

/**
 * The hero's resting state: eyebrow, three-line display headline, two CTAs.
 *
 * The headline is one `<h1>` with three `<span>` blocks rather than three
 * headings — it is a single sentence broken for measure, and the line breaks are
 * typographic, not structural. Screen readers therefore read it as one heading,
 * which is what it is.
 */
export function HeroCopy({ onBookTrip, ref }: HeroCopyProps) {
  return (
    <div ref={ref}>
      <div className="mb-5 flex items-center gap-3.5 md:mb-[30px]">
        <span
          aria-hidden="true"
          className="h-px w-6 flex-none bg-white/45 md:w-16"
        />
        <span className={`${MONO_LABEL} whitespace-nowrap text-white/72`}>
          Van Booking · {SITE_LOCATIONS.join(" & ")}
        </span>
      </div>

      <h1 className="max-w-full text-[2.5rem] leading-[1.02] text-white md:max-w-[15ch] md:text-display">
        <span className={HERO_DISPLAY_LINE}>Helping associates</span>
        <span className={HERO_DISPLAY_LINE}>get to where</span>
        <span className={`${HERO_DISPLAY_LINE} text-hero-accent`}>
          they need to be
        </span>
      </h1>

      <div className="mt-[30px] flex flex-wrap items-center gap-4 md:mt-11">
        <button type="button" onClick={onBookTrip} className={HERO_CTA_PRIMARY}>
          Book a trip
        </button>
        <Link href="/manage" className={HERO_CTA_GHOST}>
          Manage bookings
        </Link>
      </div>
    </div>
  );
}
