"use client";

import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-fetcher";
import { FIELD_HISTORY_KEY } from "@/modules/reservations/query-keys";
import type { FieldHistory } from "@/modules/reservations/types";

const EMPTY_HISTORY: FieldHistory = {
  pickupPoint: [],
  dropoffPoint: [],
  passengerName: [],
  passengerEmail: [],
  mobile: [],
};

/**
 * The signed-in requestor's own field history, shared across every combobox
 * in the wizard via React Query's cache — each caller names the same
 * `FIELD_HISTORY_KEY`, so only the first mount actually fetches.
 *
 * Never `undefined` while loading: a combobox with no suggestions yet should
 * just behave like a plain input, not juggle a loading state of its own.
 *
 * `staleTime: Infinity` because a value submitted moments ago by this same
 * session should not pop into the list mid-fill. This does NOT mean the data
 * is stale forever, though: `booking-wizard.tsx`'s `submit()` explicitly
 * invalidates `FIELD_HISTORY_KEY` right after a successful submission, so the
 * next fetch — including "Book another request", which resets the wizard's
 * OWN state without a page reload — picks up what was just booked.
 */
export function useFieldHistory(): FieldHistory {
  const query = useQuery({
    queryKey: FIELD_HISTORY_KEY,
    queryFn: () => apiFetch<FieldHistory>("/api/reservations/field-history"),
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });

  return query.data ?? EMPTY_HISTORY;
}
