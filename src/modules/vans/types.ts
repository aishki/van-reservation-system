/**
 * The van roster. A separate module from `drivers` because a van is assigned
 * per trip, not owned by a driver: any driver can take any van on any day.
 */
import type { SiteLocation } from "@/modules/reservations/types";

export interface Van {
  id: string;
  /** The fleet's own numbering, `VAN-001` upward. */
  vanNumber: string;
  /** The real identifier — a plate names a physical vehicle. Unique. */
  plate: string;
  /** e.g. "Hi Ace Super Grandia". Shown to the requestor on approval. */
  carType: string;
  site: SiteLocation;
  /** A retired van keeps its history but takes no new assignments. */
  active: boolean;
}
