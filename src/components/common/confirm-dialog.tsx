"use client";

import { useEffect, useId, useRef } from "react";
import { cn } from "@/lib/utils";

/**
 * A native `<dialog>` confirmation, generalised from `manage-view.tsx`'s
 * `CancelDialog` — the same reasoning applies to every admin action that
 * should not fire on a single misclick: `showModal()` is what makes it a real
 * modal (focus trapped, the rest of the page inert, Escape wired to
 * `cancel`, focus restored to the trigger on close); `<dialog open>` looks
 * identical and delivers none of it.
 *
 * `tone="destructive"` styles the confirm button in `bg-error`, for an action
 * the copy calls out as unable to be undone (Cancel, Mark No Show). A
 * reversible action (Revert to Approved) uses the default brand styling —
 * still a real confirmation, since a misclick still re-sends a notice, just
 * not one the button needs to look alarming about.
 *
 * No `autoFocus`: `showModal()` focuses the first focusable child, which is
 * "Keep it" — the non-destructive action, which is where a confirmation
 * should land.
 */
export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  confirmingLabel,
  busy,
  tone = "destructive",
  onKeep,
  onConfirm,
}: {
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
  /** Shown on the confirm button while `busy` — e.g. "Cancelling…". */
  confirmingLabel: string;
  busy: boolean;
  tone?: "destructive" | "default";
  onKeep: () => void;
  onConfirm: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      // Fires on Escape. The parent unmounts this component, which closes it.
      onCancel={onKeep}
      className="m-auto w-full max-w-[440px] rounded-card bg-background px-8 py-[30px] backdrop:bg-[color-mix(in_srgb,var(--color-gray-1)_45%,transparent)]"
    >
      <h3
        id={titleId}
        className="mb-2.5 text-[1.375rem] font-semibold text-plum"
      >
        {title}
      </h3>
      <p className="mb-6 text-body text-pretty text-gray-2">{body}</p>
      <div className="flex justify-end gap-3">
        <button
          type="button"
          onClick={onKeep}
          className="cursor-pointer rounded-pill border-[1.5px] border-gray-4 bg-background px-6 py-3.5 text-body font-semibold text-gray-1 hover:border-gray-3 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          Keep it
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy}
          className={cn(
            "cursor-pointer rounded-pill px-6 py-3.5 text-body font-semibold text-primary-foreground transition-[filter] hover:brightness-110 focus-visible:outline-3 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-70",
            tone === "destructive"
              ? "bg-error focus-visible:outline-error"
              : "bg-primary focus-visible:outline-primary",
          )}
        >
          {busy ? confirmingLabel : confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
