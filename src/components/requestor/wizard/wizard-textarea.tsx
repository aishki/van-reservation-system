"use client";

import { useId } from "react";
import { fieldBorder } from "@/components/requestor/wizard/wizard-theme";
import { cn } from "@/lib/utils";

interface WizardTextareaProps {
  label: string;
  placeholder?: string;
  value: string;
  rows?: number;
  invalid: boolean;
  error?: string;
  onChange: (value: string) => void;
}

/**
 * The wizard's free-text block, used for a trip's Details for Event Purpose.
 *
 * Mirrors `WizardSelect`'s label/error wiring so the two required fields in
 * step 3 read as one family: a `*` on the label, `aria-invalid` and
 * `aria-describedby` pointing at the error paragraph, and the same
 * `fieldBorder` treatment — so the invalid state is conveyed to a screen
 * reader, not only by the red border a sighted user sees.
 */
export function WizardTextarea({
  label,
  placeholder,
  value,
  rows = 3,
  invalid,
  error,
  onChange,
}: WizardTextareaProps) {
  const errorId = useId();

  return (
    <div className="mb-5">
      <label className="mb-2 block text-body text-gray-1">
        {label} <span className="text-error">*</span>
        <textarea
          value={value}
          rows={rows}
          placeholder={placeholder}
          aria-invalid={invalid}
          aria-describedby={error ? errorId : undefined}
          onChange={(event) => onChange(event.target.value)}
          className={cn(
            "mt-1.5 w-full resize-none rounded-field bg-background px-5 py-4 text-body text-gray-1 focus-visible:outline-3 focus-visible:outline-offset-1 focus-visible:outline-primary",
            fieldBorder(invalid),
          )}
        />
      </label>

      {error !== undefined && (
        <p id={errorId} role="alert" className="mt-2 text-xs text-error">
          {error}
        </p>
      )}
    </div>
  );
}
