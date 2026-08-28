/**
 * TEST DATA — the driver roster, frozen for unit tests when the live app
 * moved from fixtures to the database (the same values now load via
 * `pnpm db:seed:dev`). Pure-function tests want a stable literal dataset,
 * not whatever the seed evolves into.
 */
import type { Driver } from "@/modules/drivers/types";

export function sampleDrivers(): Driver[] {
  return [
    {
      id: "DRV-01",
      name: "Villanueva, Rey",
      mobile: "09171234567",
      site: "Manila",
      shift: "11AM-11PM",
      active: true,
    },
    {
      id: "DRV-02",
      name: "Ocampo, Dennis",
      mobile: "09171234568",
      site: "Manila",
      shift: "11PM-11AM",
      active: true,
    },
    {
      id: "DRV-03",
      name: "Sarmiento, Joel",
      mobile: "09171234569",
      site: "Iloilo",
      shift: null,
      active: true,
    },
    {
      id: "DRV-04",
      name: "Padilla, Marlon",
      mobile: "09171234570",
      site: "Iloilo",
      shift: "11PM-11AM",
      active: true,
    },
    {
      id: "DRV-05",
      name: "Aguilar, Ben",
      mobile: "09171234571",
      site: "Manila",
      shift: "11AM-11PM",
      // Inactive, to prove the roster keeps a driver's history rather than
      // deleting them — and that the workload screen says so.
      active: false,
    },
  ];
}
