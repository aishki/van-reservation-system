"use client";

import Image from "next/image";
import Link from "next/link";
import { toast } from "sonner";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { cn } from "@/lib/utils";

/**
 * Which nav item reads as current. Passed in by the page rather than derived
 * from `usePathname()`, because "Book" is current for two different locations —
 * the ride picker (which is a state of `/`, not a route) and the wizard itself.
 * A pathname cannot distinguish the first case at all.
 */
export type RequestorNavItem = "home" | "book" | "manage";

interface RequestorHeaderProps {
  active: RequestorNavItem;
  /**
   * Supplied only by the page that owns the hero. When present, "Book" is a
   * button that swaps the hero to the ride picker in place (and runs the
   * drive-by choreography); when absent we are on another route, so "Book"
   * becomes a link that lands on `/` with the picker already open.
   */
  onChooseRide?: () => void;
  /**
   * Same contract as `onChooseRide`, for the reverse direction: supplied only
   * by the page that owns the hero, where Home must swap the picker back to
   * the resting copy in place — a `Link` to `/` is a silent no-op there,
   * because the picker is component state on `/` already.
   */
  onGoHome?: () => void;
}

/**
 * Sticky portal header: the three partner logo lockups on the left, primary
 * nav on the right.
 *
 * Logo heights are the design's exact per-lockup values (they are NOT uniform —
 * the three marks have different cap heights and are balanced optically, not
 * mathematically). `width`/`height` carry each file's intrinsic pixel size so
 * Next can reserve the right aspect box; the rendered size comes from the
 * `h-*`/`w-auto` classes. Never let one of these size itself `auto` in both
 * axes — `carelon-global-solutions-logo.png` is 2486px wide and would render at
 * intrinsic size.
 *
 * Every logo MUST carry `sizes`, and the values are the real rendered widths
 * (intrinsic aspect x the `h-*` above, mobile first). Without it Next derives
 * the candidate set from the `width` prop instead: the Carelon mark's 2486px
 * width rounds its 1x candidate up to the 3840 device size and pushes its 2x
 * candidate past the maximum, leaving a srcset of exactly one entry — a
 * 3840px-wide optimization of a mark displayed 85px wide, preloaded on every
 * page load. Nothing about the page looks wrong when this happens, which is why
 * requestor-header.test.tsx asserts the attribute is present.
 *
 * The sign-out control is an ADDITION — the design's header has no account or
 * sign-out affordance anywhere, and shipping a portal with no way out is worse
 * than shipping one extra control. Kept visually subordinate (small, gray, no
 * fill) and separated by a hairline so it reads as chrome rather than as a
 * fifth nav item.
 */
export function RequestorHeader({
  active,
  onChooseRide,
  onGoHome,
}: RequestorHeaderProps) {
  const items = [
    { key: "home", label: "Home", href: "/" },
    { key: "book", label: "Book", href: "/?view=choose" },
    { key: "manage", label: "Manage", href: "/manage" },
  ] as const;

  const inPageActions: Partial<
    Record<RequestorNavItem, (() => void) | undefined>
  > = { book: onChooseRide, home: onGoHome };

  /**
   * "About" exists in the Figma IA and is in the project's Phase 1 scope, but
   * has no screen yet. A nav item that silently does nothing reads as a bug, so
   * it says so out loud rather than 404ing or being quietly removed.
   */
  const notBuiltYet = () => toast("The About page isn't built yet.");

  return (
    <header className="sticky top-0 z-40 border-b border-gray-6 bg-background">
      <div className="flex h-16 items-center justify-between gap-6 px-4 md:px-12">
        <div className="flex flex-none items-center gap-2.5 md:gap-7">
          <Image
            src="/figma/carelon-global-solutions-logo.png"
            alt="Carelon Global Solutions"
            width={2486}
            height={647}
            priority
            sizes="(min-width: 768px) 85px, 62px"
            className="block h-4 w-auto object-contain md:h-[22px]"
          />
          <Image
            src="/figma/ops-support-logo.png"
            alt="OPS Support"
            width={240}
            height={135}
            priority
            sizes="(min-width: 768px) 54px, 40px"
            className="block h-[22px] w-auto object-contain md:h-[30px]"
          />
          <Image
            src="/figma/business-intelligence-transformation-solutions-logo.png"
            alt="Business Intelligence &amp; Transformation Solutions"
            width={240}
            height={135}
            priority
            sizes="(min-width: 768px) 64px, 47px"
            className="block h-[26px] w-auto object-contain md:h-9"
          />
        </div>

        <div className="flex items-center gap-6 md:gap-12">
          <nav className="hidden items-center gap-12 md:flex">
            {items.map((item) => {
              const isActive = item.key === active;
              const className = cn(
                "border-b-2 px-0.5 py-1.5 text-[1.0625rem] transition-colors",
                isActive
                  ? "border-brand font-bold text-brand"
                  : "border-transparent text-primary hover:text-brand",
              );

              const action = inPageActions[item.key];
              if (action) {
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={action}
                    className={className}
                  >
                    {item.label}
                  </button>
                );
              }

              return (
                <Link key={item.key} href={item.href} className={className}>
                  {item.label}
                </Link>
              );
            })}
            <button
              type="button"
              onClick={notBuiltYet}
              className="border-b-2 border-transparent px-0.5 py-1.5 text-[1.0625rem] text-primary transition-colors hover:text-brand"
            >
              About
            </button>
          </nav>

          <span
            aria-hidden="true"
            className="hidden h-6 w-px bg-gray-6 md:block"
          />
          <SignOutButton />
        </div>
      </div>

      {/* Mobile nav: a horizontally scrollable pill rail below the logo row,
          because four 17px labels plus three logo lockups do not fit on a
          412px frame. */}
      <nav className="flex gap-2 overflow-x-auto px-4 pb-3 md:hidden">
        {items.map((item) => {
          const isActive = item.key === active;
          const className = cn(
            "flex-none rounded-pill border px-4 py-2 text-sm font-medium transition-colors",
            isActive
              ? "border-brand bg-brand text-primary-foreground"
              : "border-gray-4 bg-background text-primary",
          );

          const action = inPageActions[item.key];
          if (action) {
            return (
              <button
                key={item.key}
                type="button"
                onClick={action}
                className={className}
              >
                {item.label}
              </button>
            );
          }

          return (
            <Link key={item.key} href={item.href} className={className}>
              {item.label}
            </Link>
          );
        })}
        <button
          type="button"
          onClick={notBuiltYet}
          className="flex-none rounded-pill border border-gray-4 bg-background px-4 py-2 text-sm font-medium text-primary"
        >
          About
        </button>
      </nav>
    </header>
  );
}
