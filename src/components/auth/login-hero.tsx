import { LOGIN_ACCENT, type LoginVariant } from "@/components/auth/login-theme";
import { LoginVan } from "@/components/auth/login-van";
import { cn } from "@/lib/utils";

interface LoginHeroProps {
  variant: LoginVariant;
  className?: string;
}

/**
 * The decorative right-hand panel: a clipped diagonal brand wedge with the van
 * breaking past its edge. On first load the van drives in from the right
 * (LoginVan); the wedge itself is a static backdrop.
 *
 * This stays a server component — only LoginVan's entrance needs the client, so
 * the wedge and its gradient never ship JS.
 *
 * The wedge is one element and the van a SIBLING (not a child), so the van can
 * break PAST the clip into the white form area instead of being cut off at the
 * diagonal. The van sits behind the form content by paint order (the form is a
 * later positioned sibling in the page), so it never veils the inputs.
 *
 * The clip proportions are read from the Login design. Hidden below `lg`: at
 * narrow widths a diagonal split has no room to read and the panel carries zero
 * information, so dropping it avoids it ever being the reason a narrow viewport
 * gains horizontal scroll. `overflow-hidden` crops the van's bleed to the
 * viewport (its resting `-right`/`-bottom` extend past the edges by design).
 */
const WEDGE_CLIP = "[clip-path:polygon(56%_0,100%_0,100%_100%,42%_100%)]";

export function LoginHero({ variant, className }: LoginHeroProps) {
  const accent = LOGIN_ACCENT[variant];

  return (
    <div
      aria-hidden="true"
      className={cn(
        // z-0 isolates the van's z-10 to this panel, so it stays beneath the
        // panel copy (z-20) and the form (z-30) rather than the page root.
        "pointer-events-none absolute inset-0 z-0 hidden overflow-hidden lg:block",
        className,
      )}
    >
      <div className={cn("absolute inset-0", WEDGE_CLIP)}>
        <div className={cn("absolute inset-0", accent.panel)} />
        {accent.panelLobes ? (
          <div
            className={cn("absolute inset-0 opacity-50", accent.panelLobes)}
          />
        ) : null}
      </div>

      <LoginVan />
    </div>
  );
}
