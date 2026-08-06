/**
 * Per-variant styling for the two login screens (requestor/purple,
 * admin/green). Centralized so the composition isn't duplicated across
 * `login-hero.tsx`, `login-panel-copy.tsx`, `login-form.tsx`,
 * `domain-id-input.tsx`, and `password-field.tsx` — one component set,
 * parameterised by variant, never a duplicated composition.
 *
 * Values follow the imported Login design for the requestor side. The admin
 * side has no design of its own, so where the design is requestor-specific
 * (the wedge gradient, the field-line tints) admin falls back to a neutral or
 * green-derived token rather than inventing an admin composition.
 *
 * Every class string here is a complete literal (never built by
 * concatenation) so Tailwind's source scanner can find it — a class name
 * assembled at runtime from a dynamic fragment (e.g. `` `text-${accent}` ``)
 * is invisible to the scanner and would be silently pruned from the
 * compiled CSS.
 */

export type LoginVariant = "requestor" | "admin";

export interface LoginAccent {
  /**
   * The diagonal wedge's fill. Requestor uses the Login design's deep-purple
   * radial gradient (`login-hero-field`); admin keeps a flat panel token —
   * there is no admin gradient in any reference, and inventing one would be
   * designing rather than implementing.
   */
  panel: string;
  /**
   * Optional soft highlight lobes layered over the wedge for depth. Requestor
   * only (`login-hero-lobes`); absent for admin, whose flat panel needs none.
   */
  panelLobes?: string;
  /** The "System" word in the panel headline — a light tint on the dark panel. */
  panelAccentWord: string;
  /** Sign-in / Continue button fill + hover. */
  button: string;
  /** The form's "Sign in" heading colour. */
  heading: string;
  /** Domain ID / Password field labels. The design sets these to near-black. */
  fieldLabel: string;
  /** Resting outline on the Domain ID boxes and the password input. */
  fieldBorder: string;
  /** Stronger outline a Domain ID box takes once it holds a character. */
  fieldBorderFilled: string;
  /** Focus-visible border + ring on the Domain ID boxes and password input. */
  focusRing: string;
}

export const LOGIN_ACCENT: Record<LoginVariant, LoginAccent> = {
  requestor: {
    panel: "login-hero-field",
    panelLobes: "login-hero-lobes",
    panelAccentWord: "text-hero-accent",
    // Design: #3d0790 (hero-base) resting, #5009b5 (brand) on hover.
    button: "bg-hero-base hover:bg-brand",
    heading: "text-plum",
    fieldLabel: "text-gray-1",
    fieldBorder: "border-requestor-field-line",
    fieldBorderFilled: "border-requestor-field-line-strong",
    focusRing: "focus-visible:border-primary focus-visible:ring-primary/20",
  },
  admin: {
    panel: "bg-admin-panel",
    panelAccentWord: "text-white",
    button: "bg-admin-accent hover:bg-admin-accent/90",
    heading: "text-admin-heading",
    fieldLabel: "text-gray-1",
    // No admin field design to transcribe — a neutral line, green when filled.
    fieldBorder: "border-gray-4",
    fieldBorderFilled: "border-admin-accent/40",
    focusRing:
      "focus-visible:border-admin-accent focus-visible:ring-admin-accent/25",
  },
};
