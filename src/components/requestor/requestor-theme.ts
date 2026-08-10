/**
 * Class strings the requestor portal's surfaces share.
 *
 * Centralized for the same reason `login-theme.ts` exists: the design repeats a
 * handful of exact typographic treatments across unrelated blocks, and
 * re-typing them is how two of them end up one pixel apart. Every value is a
 * complete literal — never assembled from a fragment at runtime, or Tailwind's
 * source scanner cannot see it and prunes the class from the compiled CSS with
 * no error.
 */

/**
 * The monospaced micro-label. Used for the hero eyebrow, the metadata rule's
 * keys, the numbered index's category labels, and the picker's step counter —
 * four places, one treatment. 10px on mobile, 11px from `md` up.
 *
 * Monospace is the design's own choice here and is deliberately NOT
 * `--font-sans`: these labels are metadata, and the tabular feel separates them
 * from prose. Falls through Tailwind's default mono stack, which already
 * resolves to `ui-monospace, Menlo, …` — matching the design's declared stack
 * without pinning a font this project has not licensed.
 */
export const MONO_LABEL =
  "font-mono text-[10px] leading-[1.3] font-normal md:text-[11px]";

/**
 * Hero display headline. The three lines are set as blocks with a tight
 * negative tracking; the size step is the one tier `--text-display` adds above
 * Figma's h1.
 */
export const HERO_DISPLAY_LINE =
  "block font-medium tracking-[-0.045em] text-balance";

/**
 * Pill CTA sitting on the dark hero field — the white "Book a trip" primary.
 * The lift on hover is the design's own; `--color-hero-shadow` at 35%/45% is
 * the elevation base.
 */
export const HERO_CTA_PRIMARY =
  "cursor-pointer rounded-pill bg-background px-[46px] py-[18px] text-[1.0625rem] font-semibold whitespace-nowrap text-hero-base shadow-[0_10px_26px_color-mix(in_srgb,var(--color-hero-shadow)_35%,transparent)] transition-[transform,box-shadow] duration-150 hover:-translate-y-0.5 hover:shadow-[0_16px_34px_color-mix(in_srgb,var(--color-hero-shadow)_45%,transparent)] active:translate-y-0 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-white";

/** Ghost CTA beside it — "Manage bookings". */
export const HERO_CTA_GHOST =
  "cursor-pointer rounded-pill border border-white/45 px-[30px] py-[18px] text-[1.0625rem] font-medium whitespace-nowrap text-white transition-colors duration-150 hover:border-white/80 hover:bg-white/12 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-white";
