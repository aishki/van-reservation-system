"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { useId, useState } from "react";
import {
  ADMIN_CARD,
  ADMIN_PAGE,
  FOCUS_RING,
  SEGMENT_BASE,
  SEGMENT_GROUP,
  SEGMENT_ON,
} from "@/components/admin/admin-theme";
import { ChangeList } from "@/components/admin/audit/change-list";
import { apiFetch } from "@/lib/api-fetcher";
import { EM_DASH, formatInstant, formatPlainDate } from "@/lib/tz";
import { cn } from "@/lib/utils";
import {
  AUDIT_ACTION_LABELS,
  AUDIT_ACTIONS,
  type AuditAction,
  type AuditCursor,
  type AuditEntry,
  type RosterAuditEntry,
} from "@/modules/audit/types";
import {
  AUDIT_SOURCES,
  type AuditSource,
  encodeCursor,
} from "@/modules/audit/wire";
import {
  ROSTER_EVENT_LABELS,
  ROSTER_EVENT_TYPES,
  type RosterEventType,
  type RosterTarget,
} from "@/modules/roster/types";

export interface AuditPageData {
  entries: AuditEntry[];
  nextCursor: AuditCursor | null;
}

interface RosterAuditPageData {
  entries: RosterAuditEntry[];
  nextCursor: AuditCursor | null;
}

const SOURCE_LABELS: Record<AuditSource, string> = {
  reservations: "Reservations",
  roster: "Roster",
};

const ROSTER_TARGET_LABELS: Record<RosterTarget, string> = {
  drivers: "Driver",
  vans: "Van",
  admin_whitelist: "Admin",
};

interface AuditFilter {
  action: AuditAction | "";
  eventType: RosterEventType | "";
  actor: string;
  from: string;
  to: string;
}

const BLANK: AuditFilter = {
  action: "",
  eventType: "",
  actor: "",
  from: "",
  to: "",
};

/**
 * Every admin action, newest first — over two logs, reservations and roster,
 * switched by a source toggle.
 *
 * `useInfiniteQuery` keyed on `[source, filters]`, so changing either starts a
 * fresh page set rather than appending to the previous one's results — which
 * is what a plain `useQuery` plus a local array would do, and it would show
 * rows that no longer match on screen. `source` joins the key rather than
 * being just another filter because the two logs have different columns:
 * appending roster rows to reservation ones (or vice versa) would mix them in
 * one table.
 *
 * The first page is server-rendered and seeded as `initialData`, so this costs
 * no extra fetch on load. It is seeded only under the blank filter's key AND
 * `source: "reservations"` — any other key is a different question and must
 * actually be asked.
 */
export function AuditView({ initial }: { initial: AuditPageData }) {
  const [source, setSource] = useState<AuditSource>("reservations");
  const [filter, setFilter] = useState<AuditFilter>(BLANK);
  const [applied, setApplied] = useState<AuditFilter>(BLANK);
  const isBlank =
    applied.action === "" &&
    applied.eventType === "" &&
    applied.actor === "" &&
    applied.from === "" &&
    applied.to === "";

  const switchSource = (next: AuditSource) => {
    setSource(next);
    setFilter(BLANK);
    setApplied(BLANK);
  };

  const query = useInfiniteQuery({
    queryKey: ["audit-logs", source, applied],
    queryFn: ({ pageParam }) =>
      apiFetch<AuditPageData | RosterAuditPageData>(
        `/api/audit-logs?${searchOf(source, applied, pageParam)}`,
      ),
    initialPageParam: null as AuditCursor | null,
    getNextPageParam: (last) => last.nextCursor,
    initialData:
      isBlank && source === "reservations"
        ? { pages: [initial], pageParams: [null as AuditCursor | null] }
        : undefined,
  });

  const pages = query.data?.pages ?? [];
  const entryCount = pages.reduce((n, page) => n + page.entries.length, 0);

  return (
    <div className={ADMIN_PAGE}>
      <div className={`${ADMIN_CARD} min-h-[640px] pb-6`}>
        <div className="px-5 pt-5 md:px-7">
          <div className={SEGMENT_GROUP}>
            {AUDIT_SOURCES.map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={source === option}
                onClick={() => switchSource(option)}
                className={cn(
                  SEGMENT_BASE,
                  source === option ? SEGMENT_ON : "bg-transparent text-gray-1",
                )}
              >
                {SOURCE_LABELS[option]}
              </button>
            ))}
          </div>
        </div>

        <AuditFilters
          source={source}
          filter={filter}
          onChange={setFilter}
          onApply={() => setApplied(filter)}
          onReset={() => {
            setFilter(BLANK);
            setApplied(BLANK);
          }}
        />

        {entryCount === 0 ? (
          <p className="px-5 py-16 text-center text-body text-gray-2 md:px-7">
            {query.isPending
              ? "Loading the audit log…"
              : source === "roster"
                ? "No roster changes match these filters."
                : "No admin actions match these filters."}
          </p>
        ) : source === "roster" ? (
          <RosterTable
            entries={pages.flatMap(
              (page) => (page as RosterAuditPageData).entries,
            )}
          />
        ) : (
          <AuditTable
            entries={pages.flatMap((page) => (page as AuditPageData).entries)}
          />
        )}

        {query.hasNextPage && (
          <div className="px-5 pt-5 md:px-7">
            <button
              type="button"
              disabled={query.isFetchingNextPage}
              onClick={() => void query.fetchNextPage()}
              className={cn(
                "cursor-pointer rounded-pill border-[1.5px] border-primary bg-background px-8 py-3 text-body font-semibold text-primary hover:brightness-105 disabled:cursor-default disabled:opacity-60",
                FOCUS_RING,
              )}
            >
              {query.isFetchingNextPage ? "Loading…" : "Load more"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function AuditTable({ entries }: { entries: AuditEntry[] }) {
  return (
    <div className="max-w-full min-w-0 overflow-x-auto px-5 md:px-7">
      <table className="w-full min-w-[1100px] border-collapse tabular-nums">
        <thead>
          <tr>
            {["When", "Reference", "Requestor", "Action", "By", "Details"].map(
              (label) => (
                <th
                  key={label}
                  scope="col"
                  className="border-b border-gray-4 px-4 py-3.5 text-left text-body font-semibold whitespace-nowrap text-gray-1"
                >
                  {label}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.id} className="border-b border-gray-6">
              <td className="px-4 py-4 text-body whitespace-nowrap text-gray-2">
                {formatInstant(new Date(entry.at)) ?? EM_DASH}
              </td>
              <td className="px-4 py-4 text-body whitespace-nowrap text-gray-1">
                {entry.reference}
                <span className="block text-sm text-gray-3">
                  {formatPlainDate(entry.startDate) ?? entry.startDate} ·{" "}
                  {entry.site}
                </span>
              </td>
              <td className="px-4 py-4 text-body whitespace-nowrap text-gray-2">
                {entry.requestor}
              </td>
              <td className="px-4 py-4 text-body whitespace-nowrap text-gray-1">
                {AUDIT_ACTION_LABELS[entry.action]}
              </td>
              <td className="px-4 py-4 text-body whitespace-nowrap text-gray-2">
                {entry.actorName}
              </td>
              <td className="max-w-[420px] px-4 py-4 align-top">
                <ChangeList changes={entry.changes} />
                {entry.remark !== null && (
                  <p className="text-sm text-pretty text-gray-2">
                    {entry.remark}
                  </p>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RosterTable({ entries }: { entries: RosterAuditEntry[] }) {
  return (
    <div className="max-w-full min-w-0 overflow-x-auto px-5 md:px-7">
      <table className="w-full min-w-[1000px] border-collapse tabular-nums">
        <thead>
          <tr>
            {["When", "Target", "Subject", "Event", "By", "Details"].map(
              (label) => (
                <th
                  key={label}
                  scope="col"
                  className="border-b border-gray-4 px-4 py-3.5 text-left text-body font-semibold whitespace-nowrap text-gray-1"
                >
                  {label}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.id} className="border-b border-gray-6">
              <td className="px-4 py-4 text-body whitespace-nowrap text-gray-2">
                {formatInstant(new Date(entry.at)) ?? EM_DASH}
              </td>
              <td className="px-4 py-4 text-body whitespace-nowrap text-gray-1">
                {ROSTER_TARGET_LABELS[entry.target]}
              </td>
              <td className="px-4 py-4 text-body whitespace-nowrap text-gray-1">
                {entry.subject}
              </td>
              <td className="px-4 py-4 text-body whitespace-nowrap text-gray-1">
                {ROSTER_EVENT_LABELS[entry.eventType]}
              </td>
              <td className="px-4 py-4 text-body whitespace-nowrap text-gray-2">
                {entry.actorName}
              </td>
              <td className="max-w-[420px] px-4 py-4 align-top">
                <ChangeList changes={entry.changes} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AuditFilters({
  source,
  filter,
  onChange,
  onApply,
  onReset,
}: {
  source: AuditSource;
  filter: AuditFilter;
  onChange: (next: AuditFilter) => void;
  onApply: () => void;
  onReset: () => void;
}) {
  const actionId = useId();
  const actorId = useId();
  const fromId = useId();
  const toId = useId();
  const field =
    "rounded-field border border-gray-4 px-4 py-2.5 text-body outline-none focus:border-primary";

  return (
    <form
      className="flex flex-wrap items-end gap-4 px-5 py-5 md:px-7"
      onSubmit={(event) => {
        event.preventDefault();
        onApply();
      }}
    >
      {source === "reservations" ? (
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor={actionId}
            className="text-sm font-semibold text-gray-1"
          >
            Action
          </label>
          <select
            id={actionId}
            value={filter.action}
            onChange={(event) =>
              onChange({
                ...filter,
                action: event.target.value as AuditAction | "",
              })
            }
            className={field}
          >
            <option value="">All actions</option>
            {AUDIT_ACTIONS.map((action) => (
              <option key={action} value={action}>
                {AUDIT_ACTION_LABELS[action]}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor={actionId}
            className="text-sm font-semibold text-gray-1"
          >
            Event
          </label>
          <select
            id={actionId}
            value={filter.eventType}
            onChange={(event) =>
              onChange({
                ...filter,
                eventType: event.target.value as RosterEventType | "",
              })
            }
            className={field}
          >
            <option value="">All events</option>
            {ROSTER_EVENT_TYPES.map((eventType) => (
              <option key={eventType} value={eventType}>
                {ROSTER_EVENT_LABELS[eventType]}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <label htmlFor={actorId} className="text-sm font-semibold text-gray-1">
          Admin
        </label>
        <input
          id={actorId}
          type="search"
          value={filter.actor}
          placeholder="Any admin"
          onChange={(event) =>
            onChange({ ...filter, actor: event.target.value })
          }
          className={field}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={fromId} className="text-sm font-semibold text-gray-1">
          From
        </label>
        <input
          id={fromId}
          type="date"
          value={filter.from}
          onChange={(event) =>
            onChange({ ...filter, from: event.target.value })
          }
          className={field}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={toId} className="text-sm font-semibold text-gray-1">
          To
        </label>
        <input
          id={toId}
          type="date"
          value={filter.to}
          onChange={(event) => onChange({ ...filter, to: event.target.value })}
          className={field}
        />
      </div>

      <button
        type="submit"
        className={cn(
          "cursor-pointer rounded-pill border-0 bg-brand px-8 py-3 text-body font-semibold text-primary-foreground hover:brightness-105",
          FOCUS_RING,
        )}
      >
        Apply
      </button>
      <button
        type="button"
        onClick={onReset}
        className={cn(
          "cursor-pointer border-0 bg-transparent text-body font-semibold text-gray-2 underline-offset-4 hover:underline",
          FOCUS_RING,
        )}
      >
        Reset
      </button>
    </form>
  );
}

/** The filter as a query string. Empty fields are omitted, not sent blank. */
function searchOf(
  source: AuditSource,
  filter: AuditFilter,
  cursor: AuditCursor | null,
): string {
  const params = new URLSearchParams();
  if (source !== "reservations") params.set("source", source);
  if (source === "reservations" && filter.action !== "") {
    params.set("action", filter.action);
  }
  if (source === "roster" && filter.eventType !== "") {
    params.set("eventType", filter.eventType);
  }
  if (filter.actor.trim() !== "") params.set("actor", filter.actor.trim());
  if (filter.from !== "") params.set("from", filter.from);
  if (filter.to !== "") params.set("to", filter.to);
  if (cursor !== null) params.set("cursor", encodeCursor(cursor));
  return params.toString();
}
