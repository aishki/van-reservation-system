/**
 * Class strings the admin surfaces share.
 *
 * Centralized for the same reason `requestor-theme.ts` exists: the design
 * repeats a handful of exact treatments across unrelated blocks, and re-typing
 * them is how two of them end up one pixel apart. Every value is a complete
 * literal — never assembled from a fragment at runtime, or Tailwind's source
 * scanner cannot see it and prunes the class from the compiled CSS with no
 * error.
 */

/** The white panel every admin surface sits on, over the grey working area. */
export const ADMIN_CARD = "rounded-card bg-background";

/** Standard page padding inside the working area. */
export const ADMIN_PAGE = "px-4 py-6 md:px-10 md:py-7";

/** Section heading above a block of tiles — grey, regular weight, 20px. */
export const ADMIN_SECTION_HEADING = "text-xl font-normal text-gray-2";

/**
 * Focus ring used on every admin control.
 *
 * The design draws no focus state at all, on any of its screens. That is a
 * WCAG 2.4.7 failure rather than a style, so one is added everywhere — three
 * pixels of `--color-primary`, offset clear of the control.
 */
export const FOCUS_RING =
  "focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-primary";

/** Same ring, drawn inside the control — for anything flush against a boundary. */
export const FOCUS_RING_INSET =
  "focus-visible:outline-3 focus-visible:-outline-offset-2 focus-visible:outline-primary";

/**
 * The rounded-rectangle segmented control (month picker, report options).
 * Applied to the group; each button carries `SEGMENT_ON` or `SEGMENT_OFF`.
 */
export const SEGMENT_GROUP = "flex flex-wrap rounded-field bg-gray-5 p-1";
export const SEGMENT_BASE =
  "cursor-pointer rounded-[0.375rem] border-0 px-5 py-3 text-body whitespace-nowrap transition-[filter] hover:brightness-[0.97] focus-visible:outline-3 focus-visible:-outline-offset-2 focus-visible:outline-primary";
export const SEGMENT_ON = "bg-brand font-semibold text-primary-foreground";
export const SEGMENT_OFF = "bg-transparent font-normal text-gray-1";

/** The full-round outlined pill (site filters, van-type filters, date pickers). */
export const PILL_BASE =
  "cursor-pointer rounded-pill border px-6 py-3 text-body whitespace-nowrap transition-colors focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-primary";
export const PILL_ON =
  "border-brand bg-brand font-semibold text-primary-foreground";
export const PILL_OFF =
  "border-gray-4 bg-background font-normal text-gray-1 hover:border-primary";

/** Primary filled action — Generate, Approve & Save. */
export const BUTTON_PRIMARY =
  "cursor-pointer rounded-pill border-0 bg-brand px-9 py-3.5 text-[1.0625rem] font-semibold text-primary-foreground transition-[filter] hover:brightness-110 disabled:cursor-progress disabled:opacity-70 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-primary";

/** Secondary outlined action — Clear, Cancel. */
export const BUTTON_SECONDARY =
  "cursor-pointer rounded-pill border-[1.5px] border-brand bg-background px-9 py-3.5 text-[1.0625rem] font-semibold text-brand transition-colors hover:bg-brand-tint focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-primary";

/** Read-only field in the trip drawer, and the editable variant beside it. */
export const FIELD_READONLY =
  "w-full rounded-field border border-gray-6 bg-gray-5 px-4 py-3 text-body text-gray-2";
export const FIELD_EDITABLE =
  "w-full rounded-field border border-gray-4 bg-background px-4 py-3 text-body text-gray-1 focus-visible:outline-3 focus-visible:outline-offset-1 focus-visible:outline-primary";
