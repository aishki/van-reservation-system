"use client";

import { useCallback, useId, useRef, useState } from "react";
import { fieldBorder } from "@/components/requestor/wizard/wizard-theme";
import { useDismissable } from "@/hooks/use-dismissable";
import { cn } from "@/lib/utils";

interface WizardSelectProps {
  label: string;
  /** Shown when nothing is chosen yet, e.g. "Select Purpose". */
  placeholder: string;
  value: string;
  options: readonly string[];
  invalid: boolean;
  error?: string;
  onChange: (value: string) => void;
}

/**
 * The wizard's dropdown, used for Purpose and for Approving Tower Head.
 *
 * The design draws this as a plain button that toggles an absolutely-positioned
 * `role="listbox"`, and that markup alone is not operable: it has no keyboard
 * navigation, no `aria-activedescendant`, no Escape handling, and no
 * click-outside — the prototype can only be closed by clicking the trigger again
 * or picking something. This keeps the design's exact appearance and adds the
 * behaviour a listbox is required to have:
 *
 * - Up/Down move the active option, Home/End jump to the ends
 * - Enter/Space commit, Escape closes without committing
 * - Alt+Down opens (the platform convention)
 * - a pointer press anywhere outside closes it
 * - focus returns to the trigger on close, so Tab order never jumps
 *
 * Deliberately NOT a native `<select>`: the design's open state is a styled
 * panel with its own type scale and a pop animation, which a native control
 * cannot render. Base UI (already a dependency, via shadcn) has a Select that
 * would also do this — worth consolidating on if more selects appear, but that
 * component's DOM would need restyling to reach this design and this one is
 * self-contained.
 */
export function WizardSelect({
  label,
  placeholder,
  value,
  options,
  invalid,
  error,
  onChange,
}: WizardSelectProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listboxId = useId();
  const labelId = useId();
  const errorId = useId();

  // Outside-press and Escape both live in `useDismissable`, shared with the
  // manage table's row menu.
  const close = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);
  useDismissable(open, rootRef, close);

  const openAt = (index: number) => {
    setActiveIndex(index < 0 ? 0 : index);
    setOpen(true);
  };

  const commit = (index: number) => {
    const chosen = options[index];
    if (chosen !== undefined) onChange(chosen);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (!open) {
      if (
        event.key === "ArrowDown" ||
        event.key === "ArrowUp" ||
        event.key === "Enter" ||
        event.key === " "
      ) {
        event.preventDefault();
        openAt(options.indexOf(value));
      }
      return;
    }

    switch (event.key) {
      // Escape is handled by `useDismissable` on the document, because focus
      // stays on this trigger while the listbox is open (that is the point of
      // `aria-activedescendant`) and handling it in both places would fight.
      case "ArrowDown":
        event.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, options.length - 1));
        break;
      case "ArrowUp":
        event.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
        break;
      case "Home":
        event.preventDefault();
        setActiveIndex(0);
        break;
      case "End":
        event.preventDefault();
        setActiveIndex(options.length - 1);
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        commit(activeIndex);
        break;
      default:
        break;
    }
  };

  return (
    <div className="relative mb-5" ref={rootRef}>
      <span id={labelId} className="mb-2 block text-body text-gray-1">
        {label} <span className="text-error">*</span>
      </span>

      <button
        ref={triggerRef}
        type="button"
        // `combobox` rather than `listbox` on the trigger: the trigger is the
        // control, the popup is the listbox. Pairing them this way is what makes
        // `aria-activedescendant` announce correctly while focus stays here.
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-labelledby={labelId}
        aria-invalid={invalid}
        aria-describedby={error ? errorId : undefined}
        aria-activedescendant={open ? `${listboxId}-${activeIndex}` : undefined}
        onClick={() => (open ? setOpen(false) : openAt(options.indexOf(value)))}
        onKeyDown={onKeyDown}
        className={cn(
          "flex w-full cursor-pointer items-center gap-3 rounded-field bg-background px-5 py-4 text-left text-body hover:border-primary focus-visible:outline-3 focus-visible:outline-offset-1 focus-visible:outline-primary",
          fieldBorder(invalid),
          value === "" ? "text-primary" : "text-gray-1",
        )}
      >
        <span>{value === "" ? placeholder : value}</span>
        <span aria-hidden="true" className="ml-auto text-[0.7rem] text-primary">
          ▾
        </span>
      </button>

      {open && (
        // A div, not a ul: ARIA requires every child of a `listbox` to be an
        // `option`, so the `li` wrappers a list would need are exactly what is
        // not allowed here.
        <div
          id={listboxId}
          role="listbox"
          aria-labelledby={labelId}
          className="absolute top-[calc(100%+6px)] right-0 left-0 z-20 animate-in fade-in slide-in-from-top-1 rounded-field border border-gray-6 bg-popover py-2 shadow-[0_14px_34px_color-mix(in_srgb,var(--color-navy)_14%,transparent)] duration-100"
        >
          {options.map((option, index) => (
            <button
              key={option}
              type="button"
              id={`${listboxId}-${index}`}
              role="option"
              aria-selected={option === value}
              tabIndex={-1}
              onClick={() => commit(index)}
              onPointerEnter={() => setActiveIndex(index)}
              className={cn(
                "block w-full cursor-pointer px-5 py-3 text-left text-body text-brand",
                index === activeIndex ? "bg-brand-tint" : "bg-transparent",
              )}
            >
              {option}
            </button>
          ))}
        </div>
      )}

      {error !== undefined && (
        <p id={errorId} role="alert" className="mt-2 text-xs text-error">
          {error}
        </p>
      )}
    </div>
  );
}
