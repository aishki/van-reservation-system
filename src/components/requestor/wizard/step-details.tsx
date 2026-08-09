"use client";

import { useId } from "react";
import { Hint } from "@/components/common/hint";
import {
  FIELD_ERROR,
  FIELD_LABEL,
  FIELD_LABEL_MUTED,
  FIELD_LG,
  FIELD_READONLY,
  fieldBorder,
  STEP_HEADING,
  STEP_SUBHEADING,
} from "@/components/requestor/wizard/wizard-theme";
import { cn } from "@/lib/utils";
import type { DraftErrors } from "@/modules/reservations/draft";
import {
  SITE_LOCATIONS,
  type SiteLocation,
} from "@/modules/reservations/types";

interface StepDetailsProps {
  site: SiteLocation | "";
  mobile: string;
  /** From the session — not editable here, and not sent to the server. */
  name: string;
  email: string;
  errors: DraftErrors;
  onSite: (site: SiteLocation) => void;
  onMobile: (mobile: string) => void;
}

/**
 * Step 2 — which site, and confirm your contact details.
 *
 * The site choice is a real radio group (`fieldset`/`legend` + hidden native
 * radios), not the design's `aria-pressed` buttons. Two mutually exclusive
 * options ARE a radio group, and modelling them as toggle buttons costs the
 * arrow-key navigation and the "1 of 2" announcement that come free with radios,
 * while telling a screen reader they can both be pressed at once. The pill
 * visuals are unchanged — the inputs are `sr-only` and the label is the pill.
 */
export function StepDetails({
  site,
  mobile,
  name,
  email,
  errors,
  onSite,
  onMobile,
}: StepDetailsProps) {
  const nameId = useId();
  const emailId = useId();
  const mobileId = useId();
  const mobileErrorId = useId();
  const siteErrorId = useId();

  return (
    <>
      <fieldset>
        <legend className={STEP_HEADING}>
          Location <span className="text-error">*</span>
        </legend>
        <p className={cn(STEP_SUBHEADING, "mt-1.5 mb-[18px]")}>
          Which site is this trip for?
        </p>

        <div
          className="flex flex-col gap-3.5"
          aria-describedby={errors.site ? siteErrorId : undefined}
        >
          {SITE_LOCATIONS.map((option) => {
            const selected = site === option;
            return (
              <label
                key={option}
                className={cn(
                  "flex cursor-pointer items-center gap-3.5 rounded-pill border-[1.5px] px-[26px] py-[18px] text-[1.0625rem] transition-[background-color,border-color,box-shadow,color]",
                  "has-focus-visible:outline-3 has-focus-visible:outline-offset-2 has-focus-visible:outline-primary",
                  selected
                    ? "border-brand bg-brand-tint/40 font-semibold text-hero-base shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-brand)_14%,transparent)]"
                    : "border-primary bg-background font-normal text-brand hover:border-primary hover:bg-brand-wash",
                )}
              >
                <input
                  type="radio"
                  name="site"
                  value={option}
                  checked={selected}
                  onChange={() => onSite(option)}
                  className="sr-only"
                />
                <span
                  aria-hidden="true"
                  className={cn(
                    "flex size-5 flex-none items-center justify-center rounded-pill border-[1.5px] transition-colors",
                    selected
                      ? "border-brand bg-brand"
                      : "border-gray-4 bg-background",
                  )}
                >
                  <span
                    className={cn(
                      "size-2 rounded-pill bg-background transition-opacity",
                      selected ? "opacity-100" : "opacity-0",
                    )}
                  />
                </span>
                <span>{option}</span>
              </label>
            );
          })}
        </div>

        {errors.site !== undefined && (
          <p
            id={siteErrorId}
            role="alert"
            className="mt-2.5 text-xs text-error"
          >
            {errors.site}
          </p>
        )}
      </fieldset>

      <h2 className={cn(STEP_HEADING, "mt-[38px] mb-5")}>
        Confirm your information
      </h2>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 md:gap-x-6">
        <div>
          <label htmlFor={nameId} className={FIELD_LABEL_MUTED}>
            Requestor Name
          </label>
          <Hint content="Filled from your account.">
            <input
              id={nameId}
              type="text"
              value={name}
              readOnly
              aria-readonly="true"
              className={FIELD_READONLY}
            />
          </Hint>
        </div>
        <div>
          <label htmlFor={emailId} className={FIELD_LABEL_MUTED}>
            Requestor Email
          </label>
          <Hint content="Filled from your account.">
            <input
              id={emailId}
              type="email"
              value={email}
              readOnly
              aria-readonly="true"
              className={FIELD_READONLY}
            />
          </Hint>
        </div>
        <div>
          <label htmlFor={mobileId} className={FIELD_LABEL}>
            Requestor Mobile Number <span className="text-error">*</span>
          </label>
          <input
            id={mobileId}
            type="tel"
            // `numeric` not `tel`: the value is digits and spaces only, and the
            // tel keypad on iOS offers +*# which this format never uses.
            inputMode="numeric"
            autoComplete="tel-national"
            placeholder="09XX XXX XXXX"
            value={mobile}
            onChange={(event) => onMobile(event.target.value)}
            aria-invalid={errors.mobile !== undefined}
            aria-describedby={errors.mobile ? mobileErrorId : undefined}
            className={cn(FIELD_LG, fieldBorder(errors.mobile !== undefined))}
          />
          {errors.mobile !== undefined && (
            <p id={mobileErrorId} role="alert" className={FIELD_ERROR}>
              {errors.mobile}
            </p>
          )}
        </div>
      </div>

      <p className="mt-[22px] text-xs text-gray-2">
        Name and email come from your Domain ID and can&rsquo;t be edited here.
      </p>
    </>
  );
}
