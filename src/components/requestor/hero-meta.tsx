import { MONO_LABEL } from "@/components/requestor/requestor-theme";
import {
  RIDE_MODE_LABELS,
  RIDE_MODES,
  SITE_LOCATIONS,
} from "@/modules/reservations/types";

/**
 * The metadata rule under the hero: a hairline with three key/value pairs, in
 * the register of a spec sheet rather than marketing copy.
 *
 * The first two values are DERIVED from the domain vocabulary rather than
 * transcribed from the design as strings. The design hard-codes "Iloilo ·
 * Manila" and "Pickup / drop-off · Standby", which is correct today and
 * silently wrong the day a third site opens — the kind of copy that never gets
 * updated because nothing points at it. Adding to `SITE_LOCATIONS` now updates
 * this row.
 *
 * The separator is a middot with hair spacing, matching the design.
 */
export function HeroMeta() {
  const items = [
    { k: "Sites", v: SITE_LOCATIONS.join(" · ") },
    {
      k: "Ride types",
      v: RIDE_MODES.map((mode) => RIDE_MODE_LABELS[mode].compact).join(" · "),
    },
    { k: "Approval", v: "Admin Support" },
  ];

  return (
    <dl className="flex w-full flex-wrap gap-5.5 border-t border-white/20 pt-4.5 md:w-2/3 md:gap-11">
      {items.map((item) => (
        <div key={item.k} className="min-w-0">
          <dt className={`${MONO_LABEL} mb-1 text-white/55`}>{item.k}</dt>
          <dd className="text-body font-medium whitespace-nowrap text-white">
            {item.v}
          </dd>
        </div>
      ))}
    </dl>
  );
}
