"use client";

import { useId, useRef, useState } from "react";
import { useDismissable } from "@/hooks/use-dismissable";
import { cn } from "@/lib/utils";

interface WizardComboInputProps {
  value: string;
  /** The requestor's own past values for this field, most recent first. */
  suggestions: readonly string[];
  onChange: (value: string) => void;
  /**
   * Drives the on-screen keyboard (`inputMode`) only — the actual DOM
   * `type` is always `"text"`, deliberately. A real `type="email"` (or
   * `"tel"`) is exactly what tells Chrome to layer its OWN saved-address
   * autofill panel on top of this one, and `autoComplete="off"` does not
   * suppress that for email/tel specifically. Validation never reads this;
   * `isValidEmail` in `draft.ts` does that off the string value alone.
   */
  type?: "text" | "email" | "tel";
  placeholder?: string;
  autoComplete?: string;
  invalid?: boolean;
  /**
   * Explicit `id` for the `<label for>` pairing every call site uses.
   * Required, not defaulted from `useId()` in here: the label lives in the
   * PARENT, so the parent must own the id both sides agree on.
   */
  id: string;
  "aria-describedby"?: string;
  className: string;
}

/**
 * A plain text input with a filterable suggestion panel underneath — always
 * free typing, never locked to the list. Used wherever a wizard field has a
 * real history to draw from (Pickup Point, Drop-off Point, Passenger Name,
 * Passenger Email); a field with no history behaves exactly like the plain
 * `<input>` it replaces.
 *
 * Shares `WizardSelect`'s dismissal pattern (`useDismissable`, option buttons
 * living inside the same root so a click on one is never read as "outside")
 * but not its keyboard model: there `Enter` always commits the active option
 * because the trigger cannot hold free text. Here `Enter` only commits when an
 * option is actively highlighted — otherwise the requestor is mid-sentence on
 * a value of their own, and hitting Enter must not silently overwrite it with
 * whatever floated to the top of the list.
 */
export function WizardComboInput({
  value,
  suggestions,
  onChange,
  type = "text",
  placeholder,
  autoComplete = "off",
  invalid,
  id,
  className,
  ...aria
}: WizardComboInputProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Set just before `commit`'s own `.focus()` call, so the `onFocus` handler
  // that call triggers knows not to reopen what commit just closed. Without
  // this a picked value's panel never visibly closes: focus returning to the
  // input is itself a focus event, and this component treats focus as "show
  // the list" everywhere else on purpose.
  const suppressNextFocusOpen = useRef(false);
  const listboxId = useId();

  const needle = value.trim().toLowerCase();
  const filtered =
    needle === ""
      ? suggestions
      : suggestions.filter((s) => s.toLowerCase().includes(needle));

  const close = () => setOpen(false);
  useDismissable(open, rootRef, close);

  const commit = (index: number) => {
    const chosen = filtered[index];
    if (chosen !== undefined) onChange(chosen);
    setOpen(false);
    suppressNextFocusOpen.current = true;
    inputRef.current?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (!open || filtered.length === 0) return;
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
        break;
      case "ArrowUp":
        event.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
        break;
      // Only commits an ACTIVE selection — see the doc comment above.
      case "Enter":
        if (activeIndex >= 0) {
          event.preventDefault();
          commit(activeIndex);
        }
        break;
      default:
        break;
    }
  };

  const showPanel = open && filtered.length > 0;
  const inputMode =
    type === "email" ? "email" : type === "tel" ? "numeric" : undefined;

  return (
    <div className="relative" ref={rootRef}>
      <input
        ref={inputRef}
        id={id}
        type="text"
        inputMode={inputMode}
        value={value}
        placeholder={placeholder}
        autoComplete={autoComplete}
        role="combobox"
        aria-expanded={showPanel}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-invalid={invalid}
        aria-activedescendant={
          showPanel && activeIndex >= 0
            ? `${listboxId}-${activeIndex}`
            : undefined
        }
        onFocus={() => {
          setActiveIndex(-1);
          if (suppressNextFocusOpen.current) {
            suppressNextFocusOpen.current = false;
            return;
          }
          if (suggestions.length > 0) setOpen(true);
        }}
        onChange={(event) => {
          onChange(event.target.value);
          setActiveIndex(-1);
          if (suggestions.length > 0) setOpen(true);
        }}
        onKeyDown={onKeyDown}
        className={className}
        {...aria}
      />

      {showPanel && (
        // A div, not a ul — same reasoning as WizardSelect: every child of a
        // `listbox` must be an `option`, which rules out `li` wrappers.
        <div
          id={listboxId}
          role="listbox"
          aria-label={`Previously used values matching this field`}
          className="absolute top-[calc(100%+6px)] right-0 left-0 z-20 max-h-56 overflow-y-auto rounded-field border border-gray-6 bg-popover py-2 shadow-[0_14px_34px_color-mix(in_srgb,var(--color-navy)_14%,transparent)]"
        >
          {filtered.map((option, index) => (
            <button
              key={option}
              type="button"
              id={`${listboxId}-${index}`}
              role="option"
              aria-selected={index === activeIndex}
              tabIndex={-1}
              onClick={() => commit(index)}
              onPointerEnter={() => setActiveIndex(index)}
              className={cn(
                "block w-full cursor-pointer truncate px-5 py-2.5 text-left text-body text-brand",
                index === activeIndex ? "bg-brand-tint" : "bg-transparent",
              )}
            >
              {option}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
