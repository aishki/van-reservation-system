import type { AdminSite } from "@/modules/auth/roles";

/**
 * One row of `admin_whitelist`, as the roster surface sees it.
 *
 * `site` here is an `AdminSite` and permits `all` — it routes NOTIFICATIONS
 * rather than naming a place, and is never a permission boundary. Not the same
 * vocabulary as a driver's or van's `SiteLocation`.
 */
export interface AdminEntry {
  id: string;
  fullName: string;
  email: string | null;
  domainId: string | null;
  site: AdminSite;
  /** Receives the site's new-request notices. See `email/recipients.ts`. */
  notify: boolean;
  active: boolean;
  /**
   * May edit this table. Distinct from `admin_support`, which every row has:
   * that role approves trips and says nothing about who holds it.
   */
  superAdmin: boolean;
}
