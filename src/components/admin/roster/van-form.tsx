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
import { SITE_LOCATIONS } from "@/modules/reservations/types";
import type { Van } from "@/modules/vans/types";

export interface VanFormProps {
  row: Van | null;
  onDone: () => void;
}

const SITE_OPTIONS = SITE_LOCATIONS.map((site) => ({
  value: site,
  label: site,
}));

interface VanDraft {
  vanNumber: string;
  plate: string;
  carType: string;
  site: string;
}

function draftFrom(row: Van | null): VanDraft {
  return {
    vanNumber: row?.vanNumber ?? "",
    plate: row?.plate ?? "",
    carType: row?.carType ?? "",
    site: row?.site ?? "",
  };
}

interface VanErrors {
  vanNumber?: string;
  plate?: string;
  carType?: string;
  site?: string;
}

const REQUIRED = "This field is required.";
const SITE_REQUIRED = "Select a site.";

function fieldOf(details: unknown): string | null {
  if (typeof details !== "object" || details === null) return null;
  const field = (details as { field?: unknown }).field;
  return typeof field === "string" ? field : null;
}

function isVanField(value: string): value is keyof VanErrors {
  return (
    value === "vanNumber" ||
    value === "plate" ||
    value === "carType" ||
    value === "site"
  );
}

/**
 * Add/Edit for one van row. Same shape as `DriverForm` — see there for why
 * the payload is built field-by-field rather than spread from `row`, and why
 * a PATCH sends every field instead of a diff.
 */
export function VanForm({ row, onDone }: VanFormProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const isNew = row === null;
  const [draft, setDraft] = useState<VanDraft>(() => draftFrom(row));
  const [showErrors, setShowErrors] = useState(false);
  const [serverErrors, setServerErrors] = useState<VanErrors>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  const set = <K extends keyof VanDraft>(key: K, value: VanDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setServerErrors((current) => ({ ...current, [key]: undefined }));
  };

  const payload = {
    vanNumber: draft.vanNumber.trim(),
    plate: draft.plate.trim(),
    carType: draft.carType.trim(),
    site: draft.site,
  };

  const errors: VanErrors = {
    vanNumber: payload.vanNumber === "" ? REQUIRED : undefined,
    plate: payload.plate === "" ? REQUIRED : undefined,
    carType: payload.carType === "" ? REQUIRED : undefined,
    site: payload.site === "" ? SITE_REQUIRED : undefined,
  };
  const valid = Object.values(errors).every((message) => message === undefined);
  const shown: VanErrors = showErrors ? { ...errors, ...serverErrors } : {};

  const save = async () => {
    if (!valid) {
      setShowErrors(true);
      return;
    }
    setSaving(true);
    setServerErrors({});
    try {
      if (isNew) {
        await apiFetch("/api/vans", {
          method: "POST",
          body: JSON.stringify(payload),
        });
      } else {
        await apiFetch(`/api/vans/${row.id}`, {
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
      toast.error("Couldn't save that van. Try again.");
      return;
    }
    // A duplicate plate or van number names the offending input — attach the
    // message THERE rather than in a toast.
    const field = fieldOf(error.details);
    if (field !== null && isVanField(field)) {
      setServerErrors({ [field]: error.message });
      setShowErrors(true);
      return;
    }
    toast.error(error.message);
  };

  return (
    <dialog
      ref={dialogRef}
      aria-label={isNew ? "Add van" : "Edit van"}
      onCancel={onDone}
      className="m-auto w-full max-w-[480px] rounded-card border-0 bg-background p-6 backdrop:bg-[color-mix(in_srgb,var(--color-gray-1)_35%,transparent)]"
    >
      <h2 className="text-xl font-semibold text-gray-1">
        {isNew ? "Add van" : "Edit van"}
      </h2>
      <div className="mt-5 flex flex-col gap-4">
        <DrawerField
          label="Van number"
          value={draft.vanNumber}
          onChange={(value) => set("vanNumber", value)}
          error={shown.vanNumber}
        />
        <DrawerField
          label="Plate"
          value={draft.plate}
          onChange={(value) => set("plate", value)}
          error={shown.plate}
        />
        <DrawerField
          label="Car type"
          value={draft.carType}
          onChange={(value) => set("carType", value)}
          error={shown.carType}
        />
        <DrawerSelect
          label="Site"
          value={draft.site}
          options={SITE_OPTIONS}
          placeholder="Select a site"
          error={shown.site}
          onChange={(value) => set("site", value)}
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
