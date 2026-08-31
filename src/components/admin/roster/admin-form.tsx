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
import type { AdminEntry } from "@/modules/admins/types";
import { ADMIN_SITES } from "@/modules/auth/roles";
import { ROSTER_MESSAGES } from "@/modules/roster/types";

export interface AdminFormProps {
  row: AdminEntry | null;
  onDone: () => void;
}

/** `ADMIN_SITES` is already lower case — see `roster/wire.ts` on the two site
 * vocabularies. Title-cased only for display; the value sent stays lower. */
function siteLabel(site: string): string {
  return site.charAt(0).toUpperCase() + site.slice(1);
}

const SITE_OPTIONS = ADMIN_SITES.map((site) => ({
  value: site,
  label: siteLabel(site),
}));

interface AdminDraft {
  fullName: string;
  email: string;
  domainId: string;
  site: string;
  notify: boolean;
  superAdmin: boolean;
}

function draftFrom(row: AdminEntry | null): AdminDraft {
  return {
    fullName: row?.fullName ?? "",
    email: row?.email ?? "",
    domainId: row?.domainId ?? "",
    site: row?.site ?? "",
    notify: row?.notify ?? true,
    superAdmin: row?.superAdmin ?? false,
  };
}

interface AdminErrors {
  fullName?: string;
  email?: string;
  domainId?: string;
  site?: string;
}

const REQUIRED = "This field is required.";
const SITE_REQUIRED = "Select a site.";

function fieldOf(details: unknown): string | null {
  if (typeof details !== "object" || details === null) return null;
  const field = (details as { field?: unknown }).field;
  return typeof field === "string" ? field : null;
}

function isAdminField(value: string): value is keyof AdminErrors {
  return (
    value === "fullName" ||
    value === "email" ||
    value === "domainId" ||
    value === "site"
  );
}

/**
 * Add/Edit for one admin-whitelist row.
 *
 * The identity rule — an email OR a Domain ID — is caught here, on `email`,
 * mirroring `adminCreateSchema`'s `path: ["email"]`. Without this, an admin
 * with neither key set is refused by `admin_whitelist_identity_check` and the
 * user sees a bare constraint name instead of a message naming both fields.
 *
 * A PATCH sends every field, matching POST's shape, rather than a diff of
 * what changed — see `DriverForm`. For this form specifically that also means
 * the identity check above can be evaluated on the payload directly: it is
 * always the FULL resulting state, so there is no need to reproduce the
 * server's row-merged-with-patch logic (`updateAdmin`'s guardrail 4) here.
 */
export function AdminForm({ row, onDone }: AdminFormProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const isNew = row === null;
  const [draft, setDraft] = useState<AdminDraft>(() => draftFrom(row));
  const [showErrors, setShowErrors] = useState(false);
  const [serverErrors, setServerErrors] = useState<AdminErrors>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  const set = <K extends keyof AdminDraft>(key: K, value: AdminDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    if (isAdminField(key)) {
      setServerErrors((current) => ({ ...current, [key]: undefined }));
    }
  };

  const emailInput = draft.email.trim();
  const domainIdInput = draft.domainId.trim();
  const payload = {
    fullName: draft.fullName.trim(),
    email: emailInput === "" ? null : emailInput,
    domainId: domainIdInput === "" ? null : domainIdInput,
    site: draft.site,
    notify: draft.notify,
    superAdmin: draft.superAdmin,
  };

  const identityMissing = payload.email === null && payload.domainId === null;
  const errors: AdminErrors = {
    fullName: payload.fullName === "" ? REQUIRED : undefined,
    site: payload.site === "" ? SITE_REQUIRED : undefined,
    email: identityMissing ? ROSTER_MESSAGES.identityRequired : undefined,
  };
  const valid = Object.values(errors).every((message) => message === undefined);
  const shown: AdminErrors = showErrors ? { ...errors, ...serverErrors } : {};

  const save = async () => {
    if (!valid) {
      setShowErrors(true);
      return;
    }
    setSaving(true);
    setServerErrors({});
    try {
      if (isNew) {
        await apiFetch("/api/admins", {
          method: "POST",
          body: JSON.stringify(payload),
        });
      } else {
        await apiFetch(`/api/admins/${row.id}`, {
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
      toast.error("Couldn't save that admin. Try again.");
      return;
    }
    // A duplicate email or Domain ID names the offending input — attach the
    // message THERE rather than in a toast.
    const field = fieldOf(error.details);
    if (field !== null && isAdminField(field)) {
      setServerErrors({ [field]: error.message });
      setShowErrors(true);
      return;
    }
    toast.error(error.message);
  };

  return (
    <dialog
      ref={dialogRef}
      aria-label={isNew ? "Add admin" : "Edit admin"}
      onCancel={onDone}
      className="m-auto w-full max-w-[480px] rounded-card border-0 bg-background p-6 backdrop:bg-[color-mix(in_srgb,var(--color-gray-1)_35%,transparent)]"
    >
      <h2 className="text-xl font-semibold text-gray-1">
        {isNew ? "Add admin" : "Edit admin"}
      </h2>
      <div className="mt-5 flex flex-col gap-4">
        <DrawerField
          label="Name"
          value={draft.fullName}
          onChange={(value) => set("fullName", value)}
          error={shown.fullName}
        />
        <DrawerField
          label="Email"
          value={draft.email}
          onChange={(value) => set("email", value)}
          error={shown.email}
        />
        <DrawerField
          label="Domain ID"
          value={draft.domainId}
          onChange={(value) => set("domainId", value)}
          error={shown.domainId}
        />
        <DrawerSelect
          label="Site"
          value={draft.site}
          options={SITE_OPTIONS}
          placeholder="Select a site"
          error={shown.site}
          onChange={(value) => set("site", value)}
        />
        <label className="flex cursor-pointer items-start gap-3 text-[0.9375rem] leading-snug text-gray-1">
          <input
            type="checkbox"
            checked={draft.notify}
            onChange={(event) => set("notify", event.target.checked)}
            className="mt-0.5 size-[18px] flex-none cursor-pointer accent-brand"
          />
          <span>Receives notifications</span>
        </label>
        <label className="flex cursor-pointer items-start gap-3 text-[0.9375rem] leading-snug text-gray-1">
          <input
            type="checkbox"
            checked={draft.superAdmin}
            onChange={(event) => set("superAdmin", event.target.checked)}
            className="mt-0.5 size-[18px] flex-none cursor-pointer accent-brand"
          />
          <span>Manages the whitelist</span>
        </label>
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
