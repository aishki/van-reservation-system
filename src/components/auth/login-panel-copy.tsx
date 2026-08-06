import { LOGIN_ACCENT, type LoginVariant } from "@/components/auth/login-theme";
import { cn } from "@/lib/utils";

// The operations rule beneath the promise — who the service is for and who runs
// it. Static content, transcribed from the Login design.
const META = [
  { term: "Routes", detail: "Iloilo · Manila" },
  { term: "Operated by", detail: "OPS Support" },
] as const;

/**
 * The right-panel copy, aligned to the diagonal wedge (see login-hero.tsx): the
 * product name, a one-line promise, and a two-field operations rule.
 *
 * Real content, not decoration — but hidden below `lg`, exactly as the design
 * drops the whole panel on narrow viewports; there the form's own copy stands
 * alone. It fades in on load (motion-safe only, so prefers-reduced-motion gets
 * it in place) to settle alongside the van's drive-in.
 */
export function LoginPanelCopy({ variant }: { variant: LoginVariant }) {
  const accent = LOGIN_ACCENT[variant];

  return (
    <div className="pointer-events-none absolute top-[104px] right-[5vw] z-20 hidden w-[440px] max-w-[38vw] motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-right-4 motion-safe:duration-700 motion-safe:ease-out lg:block">
      <h2 className="mb-[18px] text-[3.375rem] leading-[1.03] font-medium tracking-[-0.045em] text-white">
        <span className="block">Van Reservation</span>
        <span className={cn("block", accent.panelAccentWord)}>System</span>
      </h2>
      <p className="mb-[30px] max-w-[26ch] text-[1.0625rem] leading-[1.5] font-light text-pretty text-white/80">
        Helping associates get to where they need to be.
      </p>
      <dl className="flex flex-wrap gap-x-[44px] gap-y-4 border-t border-white/20 pt-[18px]">
        {META.map((item) => (
          <div key={item.term} className="min-w-0">
            <dt className="mb-1 font-mono text-[0.8125rem] leading-tight text-white/55">
              {item.term}
            </dt>
            <dd className="text-base font-medium whitespace-nowrap text-white">
              {item.detail}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
