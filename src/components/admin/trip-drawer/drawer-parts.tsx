"use client";

import { ChevronDown } from "lucide-react";
import { useId } from "react";
import { FIELD_EDITABLE, FIELD_READONLY } from "@/components/admin/admin-theme";
import { Hint } from "@/components/common/hint";
import { cn } from "@/lib/utils";

interface DrawerSectionProps {
  label: string;
  open: boolean;
  onToggle: (open: boolean) => void;
  children: React.ReactNode;
}

/**
 * One accordion in the trip drawer.
 *
 * A native `<details>`/`<summary>`, not the design's button with
 * `aria-expanded`. The element is a real disclosure widget: it is keyboard
 * operable and correctly announced without any wiring, and browser find-in-page
 * expands it to reveal a match inside — which matters on a panel with seven
 * collapsed sections, where a hand-rolled version silently hides text from
 * Ctrl+F.
 *
 * Controlled rather than left to the browser, because validation has to be able
 * to open the section holding a field the admin has not filled in. `onToggle`
 * fires after the browser has already changed state, so it reports rather than
 * intercepts — which is why `open` is read off the event target.
 */
export function DrawerSection({
  label,
  open,
  onToggle,
  children,
}: DrawerSectionProps) {
  return (
    <details
      open={open}
      onToggle={(event) => onToggle(event.currentTarget.open)}
      className="border-b border-gray-6"
    >
      <summary
        className={cn(
          "flex cursor-pointer list-none items-center gap-3.5 py-5 text-[1.0625rem] font-semibold text-gray-1 hover:text-brand",
          "focus-visible:outline-3 focus-visible:-outline-offset-2 focus-visible:outline-primary",
          // Safari draws its own triangle through a pseudo-element that
          // `list-style: none` does not remove.
          "[&::-webkit-details-marker]:hidden",
        )}
      >
        {label}
        <ChevronDown
          aria-hidden="true"
          className={cn(
            "ml-auto size-4 text-gray-3 transition-transform duration-150",
            open && "rotate-180",
          )}
        />
      </summary>
      <div className="flex flex-col gap-4 pb-6">{children}</div>
    </details>
  );
}

interface DrawerFieldProps {
  label: string;
  value: string;
  /** Omit to render a read-only field. */
  onChange?: (value: string) => void;
  readOnly?: boolean;
  placeholder?: string;
  error?: string;
  type?: "text" | "date" | "time";
  /** Tooltip shown on the field while it is read-only. */
  lockedHint?: string;
}

/**
 * One labelled field in a drawer section.
 *
 * A locked field is a real `readOnly` input, not a `disabled` one. Disabled
 * inputs are skipped by keyboard navigation and are not read by some screen
 * readers at all — which would make the requestor's own name and number
 * unreachable to the admin reviewing the request. `readOnly` keeps the value
 * focusable, selectable and copyable, which is what an admin does with a mobile
 * number.
 */
export function DrawerField({
  label,
  value,
  onChange,
  readOnly = onChange === undefined,
  placeholder,
  error,
  type = "text",
  lockedHint,
}: DrawerFieldProps) {
  const id = useId();
  const errorId = `${id}-error`;

  return (
    <div>
      <label
        htmlFor={id}
        className="mb-1.5 block text-sm font-medium text-gray-1"
      >
        {label}
      </label>
      <Hint
        content={lockedHint ?? ""}
        when={readOnly && lockedHint !== undefined}
      >
        <input
          id={id}
          type={type}
          value={value}
          readOnly={readOnly}
          aria-readonly={readOnly || undefined}
          aria-invalid={error !== undefined || undefined}
          aria-describedby={error === undefined ? undefined : errorId}
          placeholder={placeholder}
          onChange={(event) => onChange?.(event.target.value)}
          className={cn(
            readOnly ? FIELD_READONLY : FIELD_EDITABLE,
            error !== undefined && "border-error",
          )}
        />
      </Hint>
      {error !== undefined && (
        <p id={errorId} className="mt-1.5 text-xs text-error">
          {error}
        </p>
      )}
    </div>
  );
}

interface DrawerTextAreaProps {
  label: string;
  value: string;
  /** Omit to render a read-only field. */
  onChange?: (value: string) => void;
  readOnly?: boolean;
  error?: string;
  rows?: number;
  /** Tooltip shown on the field while it is read-only. */
  lockedHint?: string;
}

/**
 * The `DrawerField` of a paragraph field — same label/error/`aria-describedby`
 * wiring, a `<textarea>` in place of the `<input>` because a paragraph in a
 * single-line field is unreadable and untypeable.
 */
export function DrawerTextArea({
  label,
  value,
  onChange,
  readOnly = onChange === undefined,
  error,
  rows = 3,
  lockedHint,
}: DrawerTextAreaProps) {
  const id = useId();
  const errorId = `${id}-error`;

  return (
    <div>
      <label
        htmlFor={id}
        className="mb-1.5 block text-sm font-medium text-gray-1"
      >
        {label}
      </label>
      <Hint
        content={lockedHint ?? ""}
        when={readOnly && lockedHint !== undefined}
      >
        <textarea
          id={id}
          value={value}
          rows={rows}
          readOnly={readOnly}
          aria-readonly={readOnly || undefined}
          aria-invalid={error !== undefined || undefined}
          aria-describedby={error === undefined ? undefined : errorId}
          onChange={(event) => onChange?.(event.target.value)}
          className={cn(
            "resize-y",
            readOnly ? FIELD_READONLY : FIELD_EDITABLE,
            error !== undefined && "border-error",
          )}
        />
      </Hint>
      {error !== undefined && (
        <p id={errorId} className="mt-1.5 text-xs text-error">
          {error}
        </p>
      )}
    </div>
  );
}

interface DrawerSelectProps {
  label: string;
  /** `""` selects the placeholder. */
  value: string;
  options: { value: string; label: string }[];
  placeholder: string;
  error?: string;
  /** While the options are still loading there is nothing to choose from. */
  disabled?: boolean;
  onChange: (value: string) => void;
}

/**
 * A labelled select, for a field whose values come from a roster rather than
 * from typing.
 *
 * `disabled` here where `DrawerField` deliberately prefers `readOnly`: a
 * `<select>` has no read-only state, and the only thing this one disables is
 * the moment before its options have arrived — not a value the admin needs to
 * read, which is the case `readOnly` exists to protect.
 */
export function DrawerSelect({
  label,
  value,
  options,
  placeholder,
  error,
  disabled = false,
  onChange,
}: DrawerSelectProps) {
  const id = useId();
  const errorId = `${id}-error`;

  return (
    <div>
      <label
        htmlFor={id}
        className="mb-1.5 block text-sm font-medium text-gray-1"
      >
        {label}
      </label>
      <select
        id={id}
        value={value}
        disabled={disabled}
        aria-invalid={error !== undefined || undefined}
        aria-describedby={error === undefined ? undefined : errorId}
        onChange={(event) => onChange(event.target.value)}
        className={cn(
          FIELD_EDITABLE,
          "cursor-pointer disabled:cursor-not-allowed disabled:opacity-60",
          error !== undefined && "border-error",
        )}
      >
        {/* Disabled once a value is picked: otherwise it reads as a "clear
            the assignment" choice, but selecting it is a silent no-op —
            `driverInputOf`/`vanInputOf` map "" to null, meaning "leave
            unchanged", not "unassign". There is no way to clear an
            assignment; this option must not look like one. */}
        <option value="" disabled={value !== ""}>
          {placeholder}
        </option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {error !== undefined && (
        <p id={errorId} className="mt-1.5 text-xs text-error">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * A value with no input — used where the data is a list rather than a string.
 *
 * The design renders the passenger list as one comma-joined value inside a text
 * input ("Reyes K. · Dizon M. · …"), which makes four people look like one
 * editable string and loses their Domain IDs. A description list keeps each
 * passenger a separate item.
 */
export function DrawerReadout({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="mb-1.5 text-sm font-medium text-gray-1">{label}</p>
      <div className="rounded-field border border-gray-6 bg-gray-5 px-4 py-3 text-body text-gray-2">
        {children}
      </div>
    </div>
  );
}
