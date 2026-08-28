/**
 * TEST DATA — the van roster, frozen for unit tests. Plates are obviously
 * fictional; Task 12 seeds the client's real roster into the database.
 */
import type { Van } from "@/modules/vans/types";

export function sampleVans(): Van[] {
  return [
    {
      id: "VAN-01",
      vanNumber: "VAN-001",
      plate: "TEST-001",
      carType: "Hi Ace Super Grandia",
      site: "Manila",
      active: true,
    },
    {
      id: "VAN-02",
      vanNumber: "VAN-002",
      plate: "TEST-002",
      carType: "Hi Ace Super Grandia",
      site: "Manila",
      active: true,
    },
    {
      id: "VAN-03",
      vanNumber: "VAN-003",
      plate: "TEST-003",
      carType: "Urvan",
      site: "Iloilo",
      active: true,
    },
    {
      id: "VAN-04",
      vanNumber: "VAN-004",
      plate: "TEST-004",
      carType: "Urvan",
      site: "Iloilo",
      // Inactive, to prove the roster keeps a van's history rather than
      // deleting it — and that inactive vans still surface in the list.
      active: false,
    },
  ];
}
