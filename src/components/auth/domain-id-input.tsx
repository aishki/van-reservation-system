"use client";

import { useRef } from "react";
import { cn } from "@/lib/utils";
import { canonicalDomainId } from "@/modules/auth/domain-id";

// Matches the shape of the seven boxes on the design form and the server's
// `z.string().length(7)` check in stub.ts — kept as a local constant rather
// than imported from the auth module, since this is a UI-layer concern
// (how many boxes to render) that happens to coincide with the server's
// validation length, not a shared contract.
const DOMAIN_ID_LENGTH = 7;

interface DomainIdInputProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  /** Literal Tailwind class strings from `LOGIN_ACCENT` — see login-theme.ts. */
  accent: {
    fieldLabel: string;
    focusRing: string;
    fieldBorder: string;
    fieldBorderFilled: string;
  };
  disabled?: boolean;
}

export function DomainIdInput({
  id,
  value,
  onChange,
  accent,
  disabled,
}: DomainIdInputProps) {
  const boxRefs = useRef<Array<HTMLInputElement | null>>([]);
  const chars = Array.from(
    { length: DOMAIN_ID_LENGTH },
    (_, i) => value[i] ?? "",
  );
  const filled = chars.filter(Boolean).length;

  function setCharAt(index: number, char: string) {
    const next = chars.slice();
    next[index] = char;
    onChange(next.join(""));
  }

  function handleChange(index: number, raw: string) {
    // `maxLength` already caps native typing/paste-into-one-box at one
    // character; `.slice(-1)` is a second guard for the rare case a
    // controlled update slips a longer string through (e.g. IME composition).
    // Upper-cased on the value, not just via the `uppercase` class: the CSS
    // changes only what is drawn, so a typed `a` would still reach the API
    // lower case — which the directory rejects.
    const char = raw.slice(-1).toUpperCase();
    setCharAt(index, char);
    if (char && index < DOMAIN_ID_LENGTH - 1) {
      boxRefs.current[index + 1]?.focus();
    }
  }

  function handleKeyDown(
    index: number,
    event: React.KeyboardEvent<HTMLInputElement>,
  ) {
    // Only fires when the CURRENT box is already empty — a first backspace
    // on a filled box just clears it (native onChange handles that) without
    // moving focus, matching how OTP-style inputs are conventionally used.
    if (event.key === "Backspace" && chars[index] === "" && index > 0) {
      event.preventDefault();
      setCharAt(index - 1, "");
      boxRefs.current[index - 1]?.focus();
    }
  }

  function handlePaste(event: React.ClipboardEvent<HTMLInputElement>) {
    const pasted = canonicalDomainId(event.clipboardData.getData("text"));
    if (pasted.length === DOMAIN_ID_LENGTH) {
      event.preventDefault();
      onChange(pasted);
      boxRefs.current[DOMAIN_ID_LENGTH - 1]?.focus();
    }
    // A paste of any other length falls through to native paste-into-one-box
    // behaviour, which `maxLength` truncates to a single character.
  }

  return (
    <fieldset className="relative flex flex-col gap-3 border-0 p-0">
      <legend
        className={cn("p-0 text-[0.9375rem] font-medium", accent.fieldLabel)}
      >
        Domain ID
      </legend>
      {/* Progress counter — decorative (aria-hidden), so the group's accessible
          name stays exactly "Domain ID". Pinned to the label's baseline. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute top-0 right-0 font-mono text-[0.8125rem] text-gray-3"
      >
        {filled}/{DOMAIN_ID_LENGTH}
      </span>
      <div className="flex gap-2 sm:gap-2.5">
        {chars.map((char, index) => (
          <input
            // biome-ignore lint/suspicious/noArrayIndexKey: seven fixed boxes, one per character position — never reordered/inserted/removed, so the index is each box's stable identity.
            key={index}
            ref={(el) => {
              boxRefs.current[index] = el;
            }}
            id={`${id}-${index}`}
            type="text"
            inputMode="text"
            autoComplete="off"
            autoCapitalize="characters"
            maxLength={1}
            aria-label={`Domain ID character ${index + 1} of ${DOMAIN_ID_LENGTH}`}
            value={char}
            onChange={(event) => handleChange(index, event.target.value)}
            onKeyDown={(event) => handleKeyDown(index, event)}
            onPaste={handlePaste}
            disabled={disabled}
            required
            className={cn(
              "size-[46px] rounded-[0.75rem] border text-center text-[1.25rem] font-medium uppercase outline-none transition-[color,background-color,border-color,box-shadow] focus-visible:ring-[3px] sm:size-[54px]",
              char ? "bg-white" : "bg-brand-wash",
              char ? accent.fieldBorderFilled : accent.fieldBorder,
              accent.focusRing,
            )}
          />
        ))}
      </div>
    </fieldset>
  );
}
