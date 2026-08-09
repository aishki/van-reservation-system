/**
 * Field treatments the booking wizard repeats across three steps.
 *
 * Same rationale as `login-theme.ts` and `requestor-theme.ts`: the design uses a
 * handful of exact input treatments in a dozen places, and re-typing them is how
 * two inputs end up two pixels apart. Every string is a complete literal so
 * Tailwind's scanner can see it.
 *
 * The design uses two input sizes — the roomier `16px 20px` on step 2's contact
 * block and a tighter `14px 18px` everywhere in step 3. Both are here rather
 * than normalised to one, because the difference is deliberate: step 2 has three
 * fields and room to breathe, step 3 packs four to a row.
 */

/** Step 2's contact fields. */
export const FIELD_LG =
  "w-full rounded-field bg-background px-5 py-4 text-body focus-visible:outline-3 focus-visible:outline-offset-1 focus-visible:outline-primary";

/** Step 3's schedule and passenger fields. */
export const FIELD_SM =
  "w-full rounded-field bg-background px-[18px] py-3.5 text-body focus-visible:outline-3 focus-visible:outline-offset-1 focus-visible:outline-primary";

/**
 * Name and email, which come from the Domain ID and cannot be edited. Borderless
 * on gray-5 rather than a disabled bordered input — the design distinguishes
 * "this is information" from "this input is unavailable right now".
 */
export const FIELD_READONLY =
  "w-full rounded-field border-0 bg-gray-5 px-5 py-4 text-body text-gray-1";

/** Applied on top of FIELD_* to signal an invalid value. */
export const FIELD_BORDER_OK = "border border-gray-4";
export const FIELD_BORDER_ERROR = "border border-error";

export function fieldBorder(invalid: boolean): string {
  return invalid ? FIELD_BORDER_ERROR : FIELD_BORDER_OK;
}

export const FIELD_LABEL = "mb-2 block text-body text-gray-1";
export const FIELD_LABEL_MUTED = "mb-2 block text-body text-gray-2";
export const FIELD_LABEL_SM = "mb-1.5 block text-sm text-gray-1";

/** Inline validation message. `role="alert"` is applied at the call site. */
export const FIELD_ERROR = "mt-2 text-xs text-error";

/** Step heading — the large brand-purple title at the top of each step. */
export const STEP_HEADING =
  "text-[1.75rem] leading-9 font-medium tracking-[-0.012em] text-balance text-brand";

/** Explanatory line under a step heading. */
export const STEP_SUBHEADING = "text-body text-gray-2";

/** Sub-section heading inside step 3 ("Passengers", "Schedule"). */
export const STEP_SUBSECTION =
  "text-[1.0625rem] leading-6 font-semibold text-gray-1";

/** Primary pill action — Continue / Submit. */
export const WIZARD_NEXT =
  "ml-auto flex cursor-pointer items-center gap-2.5 rounded-pill bg-brand px-[38px] py-[15px] text-body font-semibold text-primary-foreground transition-[filter] hover:brightness-110 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-progress disabled:opacity-70";

/** Secondary pill action — Back. */
export const WIZARD_BACK =
  "cursor-pointer rounded-pill border-[1.5px] border-brand bg-background px-[34px] py-[15px] text-body font-semibold text-brand transition-colors hover:bg-brand-tint/40 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-primary";
