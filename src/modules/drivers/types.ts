/**
 * The driver roster and the load each driver is carrying (FR-13, FR-14).
 *
 * A separate module from `reservations` because drivers outlive any one
 * reservation: the spec gives them their own table, their own CRUD endpoints,
 * and a Phase 2 portal of their own.
 *
 * Van identity is deliberately NOT here — it lives on `vans`, and a van is
 * assigned per trip rather than owned by a driver.
 */

/** Hours a driver is scheduled for in one week before the row reads as over. */
export const WEEKLY_HOURS_CAP = 40;

export interface Driver {
  id: string;
  /**
   * As the roster records it — the real data is "First Last" ("Ronald
   * Japitana"), not the "Last, First" this comment previously claimed.
   * `initialsFor` handles both forms.
   */
  name: string;
  mobile: string;
  site: string;
  /**
   * Free text, and null until set — the Iloilo drivers have no shift yet, and
   * Manila's are "11AM-11PM" / "11PM-11AM". Editable in the Phase 2 driver
   * dashboard, which is why this is not a closed vocabulary.
   */
  shift: string | null;
  /**
   * A deactivated driver keeps their history but takes no new assignments.
   * Deleting them instead would orphan every trip they have already driven.
   */
  active: boolean;
}
