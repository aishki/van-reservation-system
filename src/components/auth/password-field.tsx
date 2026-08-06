"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

interface PasswordFieldProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  /** Literal Tailwind class strings from `LOGIN_ACCENT` — see login-theme.ts. */
  accent: { fieldLabel: string; focusRing: string; fieldBorder: string };
  disabled?: boolean;
}

export function PasswordField({
  id,
  value,
  onChange,
  accent,
  disabled,
}: PasswordFieldProps) {
  const [revealed, setRevealed] = useState(false);

  return (
    <div className="flex flex-col gap-3">
      <label
        htmlFor={id}
        className={cn("text-[0.9375rem] font-medium", accent.fieldLabel)}
      >
        Password
      </label>
      <div className="relative">
        <input
          id={id}
          type={revealed ? "text" : "password"}
          autoComplete="current-password"
          placeholder="Enter your password"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          required
          className={cn(
            "w-full rounded-[0.75rem] border bg-brand-wash py-[17px] pr-[60px] pl-5 text-base outline-none transition-[color,background-color,border-color,box-shadow] focus-visible:bg-white focus-visible:ring-[3px]",
            accent.fieldBorder,
            accent.focusRing,
          )}
        />
        {/* type="button" — inside the <form>, the default type="submit" would
            fire the login mutation every time someone toggles visibility. */}
        <button
          type="button"
          onClick={() => setRevealed((prev) => !prev)}
          aria-label={revealed ? "Hide password" : "Show password"}
          className="absolute inset-y-0 right-4 flex items-center text-gray-2 transition-colors hover:text-brand"
        >
          {/* An eye that gains a strike-through when the password is masked —
              the accessible name (above) is what actually conveys the state. */}
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
            <circle cx="12" cy="12" r="3.1" />
            {!revealed && <line x1="3.5" y1="20.5" x2="20.5" y2="3.5" />}
          </svg>
        </button>
      </div>
    </div>
  );
}
