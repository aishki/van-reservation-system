import Image from "next/image";
import { cn } from "@/lib/utils";

interface HeroShellProps {
  /** The swapping content block — either the marketing copy or the ride picker. */
  children: React.ReactNode;
  /** The three-column metadata rule pinned below the content. */
  meta: React.ReactNode;
  /**
   * Attached to the van so the swap choreography can drive it right-to-left.
   * Optional: the copy sweep runs with or without it, so the hero degrades
   * cleanly if the photograph is ever unavailable again.
   */
  vanRef?: React.Ref<HTMLImageElement>;
  className?: string;
}

/**
 * The editorial hero's full-bleed purple field: a three-stop radial gradient,
 * two blob lobes, a bottom legibility scrim, and (once the asset lands) the van
 * photograph bleeding off the right edge.
 *
 * Stacking is explicit rather than inherited from DOM order. The design
 * document leaves the copy block at `z-index: auto` while the van sits at 2 and
 * the scrim at 3, which per CSS paints both decorative layers ON TOP of the
 * headline — harmless there only because the van is masked away on its left and
 * the copy is white on a dark scrim. Relying on that is fragile, so the order
 * here states the intent: van behind the scrim, scrim behind the content, so
 * the scrim does the job it exists for (darkening the busy lower-right of the
 * photograph beneath the text) instead of veiling the text itself.
 */
export function HeroShell({
  children,
  meta,
  vanRef,
  className,
}: HeroShellProps) {
  return (
    <main
      className={cn(
        "relative flex flex-1 flex-col overflow-hidden bg-hero-base",
        "px-4 pt-10 pb-8 md:px-12 md:pt-14 md:pb-10",
        className,
      )}
    >
      <div
        aria-hidden="true"
        className="hero-field pointer-events-none absolute inset-0 z-0"
      />
      <div
        aria-hidden="true"
        className="hero-lobes pointer-events-none absolute inset-0 z-0 opacity-50"
      />

      {/*
        The van photograph, bleeding off the right edge and down past the
        bottom. Decorative, so `alt=""` and `aria-hidden` — it carries no
        information the copy does not, and announcing it would only add noise.

        `w-*` plus `h-auto` drives the real size; `width`/`height` are the
        file's true intrinsic pixels (1734x787) purely so Next reserves the
        correct aspect box. `max-w-none` is required — the global `img`
        max-width would otherwise clamp it to the container and kill the bleed.

        `priority` because this is the hero's primary visual and sits above the
        fold; without it Next lazy-loads and the van visibly pops in.

        Hidden below `md`, as in the design: at 412px there is no edge to bleed
        past, and the mask's left-hand fade has no room to read.
      */}
      <Image
        ref={vanRef}
        src="/assets/van-side-full.png"
        alt=""
        aria-hidden="true"
        width={1734}
        height={787}
        priority
        sizes="min(104vw, 1520px)"
        className="hero-van-mask pointer-events-none absolute right-[-200px] bottom-[-150px] z-10 hidden h-auto w-[min(104vw,1520px)] max-w-none opacity-95 drop-shadow-[0_30px_60px_color-mix(in_srgb,var(--color-hero-shadow)_55%,transparent)] md:block"
      />

      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 z-20 h-[44%] bg-linear-to-b from-transparent to-hero-scrim/72"
      />

      {/* `flex-1` plus `justify-center` distributes the leftover viewport height
          here, which keeps the copy optically centred while the asymmetric
          top/bottom padding above holds it slightly high — and pins the metadata
          rule to the bottom edge without absolute positioning. The `md:pb-24`
          shortens the centering box at the bottom, lifting the text group
          further per the design review (2026-08-07). */}
      <div className="relative z-30 mx-auto flex w-full max-w-[1240px] flex-1 flex-col justify-center md:pb-24">
        {children}
      </div>

      <div className="relative z-30 mx-auto mt-8 w-full max-w-[1240px]">
        {meta}
      </div>
    </main>
  );
}
