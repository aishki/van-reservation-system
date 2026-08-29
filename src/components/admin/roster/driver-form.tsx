"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  BUTTON_PRIMARY,
  BUTTON_SECONDARY,
} from "@/components/admin/admin-theme";
import {
  DrawerField,
  DrawerSelect,
} from "@/components/admin/trip-drawer/drawer-parts";
import { ApiError, apiFetch } from "@/lib/api-fetcher";
import type { Driver } from "@/modules/drivers/types";
import { SITE_LOCATIONS } from "@/modules/reservations/types";

export interface DriverFormProps {
  row: Driver | null;
  onDone: () => void;
}

const SITE_OPTIONS = SITE_LOCATIONS.map((site) => ({
  value: site,
  label: site,
}));

interface DriverDraft {
  name: string;
  mobile: string;
  site: string;
  shift: string;
}

function draftFrom(row: Driver | null): DriverDraft {
  return {
    name: row?.name ?? "",
    mobile: row?.mobile ?? "",
    site: row?.site ?? "",
    shift: row?.shift ?? "",
  };
}

interface DriverErrors {
  name?: string;
  mobile?: string;
  site?: string;
}

const REQUIRED = "This field is required.";
const SITE_REQUIRED = "Select a site.";

function fieldOf(details: unknown): string | null {
  if (typeof details !== "object" || details === null) return null;
  const field = (details as { field?: unknown }).field;
  return typeof field === "string" ? field : null;
}

function isDriverField(value: string): value is keyof DriverErrors {
  return value === "name" || value === "mobile" || value === "site";
}

/**
 * Add/Edit for one driver row — a centered modal, not a slide-over: unlike
 * the trip drawer there is no long read-only context to scroll past.
 *
 * The payload is built field-by-field from `draft`, never `{ ...row, ...draft
 * }` — `row` carries `id` and `active`, and `driverCreateSchema` /
 * `driverPatchSchema` are both `.strict()`, so either key would get the whole
 * request refused rather than silently dropped.
 *
 * A PATCH sends every field, matching POST's shape, rather than a diff of
 * what changed — the trip drawer's driver/van assignment follows the same
 * rule (see `trip-drawer.tsx`), and it means validation never has to ask what
 * the row used to say.
 */
export function DriverForm({ row, onDone }: DriverFormProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const isNew = row === null;
  const [draft, setDraft] = useState<DriverDraft>(() => draftFrom(row));
  const [showErrors, setShowErrors] = useState(false);
  const [serverErrors, setServerErrors] = useState<DriverErrors>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  const set = <K extends keyof DriverDraft>(key: K, value: DriverDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setServerErrors((current) => ({ ...current, [key]: undefined }));
  };

  const payload = {
    name: draft.name.trim(),
    mobile: draft.mobile.trim(),
    site: draft.site,
    // Blank means "no shift on file" — Iloilo's drivers have none — not an
    // empty string, which `driverCreateSchema`'s `text` validator would
    // refuse as too short.
    shift: draft.shift.trim() === "" ? null : draft.shift.trim(),
  };

  const errors: DriverErrors = {
    name: payload.name === "" ? REQUIRED : undefined,
    mobile: payload.mobile === "" ? REQUIRED : undefined,
    site: payload.site === "" ? SITE_REQUIRED : undefined,
  };
  const valid = Object.values(errors).every((message) => message === undefined);
  const shown: DriverErrors = showErrors ? { ...errors, ...serverErrors } : {};

  const save = async () => {
    if (!valid) {
      setShowErrors(true);
      return;
    }
    setSaving(true);
    setServerErrors({});
    try {
      if (isNew) {
        await apiFetch("/api/drivers", {
          method: "POST",
          body: JSON.stringify(payload),
        });
      } else {
        await apiFetch(`/api/drivers/${row.id}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
      }
      onDone();
    } catch (error) {
      handleSaveError(error);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveError = (error: unknown) => {
    if (!(error instanceof ApiError)) {
      toast.error("Couldn't save that driver. Try again.");
      return;
    }
    // A refused write names the offending input — attach the message THERE
    // rather than in a toast, so a duplicate lands on the field it is about.
    const field = fieldOf(error.details);
    if (field !== null && isDriverField(field)) {
      setServerErrors({ [field]: error.message });
      setShowErrors(true);
      return;
    }
    toast.error(error.message);
  };

  return (
    <dialog
      ref={dialogRef}
      aria-label={isNew ? "Add driver" : "Edit driver"}
      onCancel={onDone}
      className="m-auto w-full max-w-[480px] rounded-card border-0 bg-background p-6 backdrop:bg-[color-mix(in_srgb,var(--color-gray-1)_35%,transparent)]"
    >
      <h2 className="text-xl font-semibold text-gray-1">
        {isNew ? "Add driver" : "Edit driver"}
      </h2>
      <div className="mt-5 flex flex-col gap-4">
        <DrawerField
          label="Name"
          value={draft.name}
          onChange={(value) => set("name", value)}
          error={shown.name}
        />
        <DrawerField
          label="Mobile"
          value={draft.mobile}
          onChange={(value) => set("mobile", value)}
          error={shown.mobile}
        />
        <DrawerSelect
          label="Site"
          value={draft.site}
          options={SITE_OPTIONS}
          placeholder="Select a site"
          error={shown.site}
          onChange={(value) => set("site", value)}
        />
        <DrawerField
          label="Shift"
          value={draft.shift}
          onChange={(value) => set("shift", value)}
          placeholder="e.g. 11AM-11PM"
        />
      </div>
      <div className="mt-6 flex justify-end gap-3">
        <button type="button" onClick={onDone} className={BUTTON_SECONDARY}>
          Cancel
        </button>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className={BUTTON_PRIMARY}
        >
          Save
        </button>
      </div>
    </dialog>
  );
}
