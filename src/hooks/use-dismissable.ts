"use client";

import { useEffect } from "react";

/**
 * Closes a transient popup on Escape or on a pointer press outside it.
 *
 * Shared by the wizard's select and the manage table's row menu, which both need
 * exactly this and nothing more. The design document implements neither: its
 * dropdowns can only be closed by re-clicking the trigger or choosing something,
 * so a keyboard user who opens one has no way out and two open menus can coexist.
 *
 * `pointerdown`, not `click`: a click listener fires AFTER the trigger's own
 * handler has already toggled state, so pressing an open trigger would close and
 * immediately reopen it.
 *
 * `keydown` is bound on the document rather than the popup, because focus may
 * legitimately sit on the trigger (a combobox keeps focus there and moves
 * `aria-activedescendant` instead), in which case a listener on the popup never
 * sees the key.
 */
export function useDismissable(
  open: boolean,
  ref: React.RefObject<HTMLElement | null>,
  onClose: () => void,
): void {
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, ref, onClose]);
}
