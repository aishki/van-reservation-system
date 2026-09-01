/**
 * Every person the dev dataset references. Domain IDs are stable constants;
 * the requestors' come from the design document's own passenger rows, the
 * admins' are invented and MUST NOT collide with `dev-identities.ts`
 * (AG80389, AM37315, AL12138, AM03146, AH85664, AL95338, AM65108, AB12345,
 * CD67890).
 *
 * `name` is the users-table form ("Arielle Jimera" — what a stub login would
 * upsert); `displayName` is the "Last, First" form the UI shows, used for
 * reservation snapshots and event actor names.
 */
export interface SeedPerson {
  domainId: string;
  name: string;
  displayName: string;
  email: string;
  role: "associate" | "admin_support";
}

export const SEED_PEOPLE: readonly SeedPerson[] = [
  // Requestors (design sample data).
  {
    // The design document's sample requestor, and also a real Admin Support
    // member (`ADMIN_WHITELIST_SEED`). Both at once is legal and intended: an
    // admin is also an associate who needs a van. Her role is therefore
    // admin_support — a login would resolve it that way from the whitelist
    // regardless of what this row says, and the two disagreeing is worse.
    domainId: "AM65108",
    name: "Arielle Jimera",
    displayName: "Jimera, Arielle",
    email: "arielle.jimera@carelon.com",
    role: "admin_support",
  },
  {
    domainId: "AM10394",
    name: "Marco Dizon",
    displayName: "Dizon, Marco",
    email: "marco.dizon@carelon.com",
    role: "associate",
  },
  {
    domainId: "AK47281",
    name: "Kaye Reyes",
    displayName: "Reyes, Kaye",
    email: "kaye.reyes@carelon.com",
    role: "associate",
  },
  {
    domainId: "AL55210",
    name: "Liza Salcedo",
    displayName: "Salcedo, Liza",
    email: "liza.salcedo@carelon.com",
    role: "associate",
  },
  {
    domainId: "AG80017",
    name: "Angel Mateo",
    displayName: "Mateo, Angel",
    email: "angel.mateo@carelon.com",
    role: "associate",
  },
  // Admin actors. Ivan Cruz also appears as a generated requestor — ONE row,
  // role admin_support; the reservation snapshot carries his name either way.
  {
    domainId: "NA20001",
    name: "Norlyn Abanto",
    displayName: "Abanto, Norlyn",
    email: "norlyn.abanto@carelon.com",
    role: "admin_support",
  },
  {
    domainId: "ZB20002",
    name: "Zara Buenaflor",
    displayName: "Buenaflor, Zara",
    email: "zara.buenaflor@carelon.com",
    role: "admin_support",
  },
  {
    domainId: "IC20003",
    name: "Ivan Cruz",
    displayName: "Cruz, Ivan",
    email: "ivan.cruz@carelon.com",
    role: "admin_support",
  },
] as const;

export function personByDisplayName(displayName: string): SeedPerson {
  const person = SEED_PEOPLE.find((p) => p.displayName === displayName);
  if (person === undefined) {
    throw new Error(`No seed person named "${displayName}"`);
  }
  return person;
}

/** The roster from the old drivers fixture, verbatim (wire-case values). */
export const SEED_DRIVERS = [
  {
    name: "Villanueva, Rey",
    mobile: "09171234567",
    site: "Manila",
    shift: "11AM-11PM",
    active: true,
  },
  {
    name: "Ocampo, Dennis",
    mobile: "09171234568",
    site: "Manila",
    shift: "11PM-11AM",
    active: true,
  },
  {
    name: "Sarmiento, Joel",
    mobile: "09171234569",
    site: "Iloilo",
    shift: null,
    active: true,
  },
  {
    name: "Padilla, Marlon",
    mobile: "09171234570",
    site: "Iloilo",
    shift: "11PM-11AM",
    active: true,
  },
  // Inactive: proves the roster keeps history rather than deleting drivers.
  {
    name: "Aguilar, Ben",
    mobile: "09171234571",
    site: "Manila",
    shift: "11AM-11PM",
    active: false,
  },
] as const;

/**
 * The van roster (Slice 2's fleet split), two per site. Mirrors the real
 * fleet from `seeds/20260827000000_fleet_roster.ts` verbatim — van_number
 * AND plate, both unique-constrained — rather than inventing parallel
 * numbers: the dev seed truncates `vans` before inserting and the prod seed
 * upserts by `van_number`, so identical rows mean `pnpm db:seed` and
 * `pnpm db:seed:dev` can run in either order, repeatedly, without a unique
 * violation. Keep the two lists in sync by hand if the fleet ever changes.
 */
export const SEED_VANS = [
  {
    vanNumber: "VAN-001",
    plate: "FAR 8931",
    carType: "Toyota GL",
    site: "Iloilo",
  },
  {
    vanNumber: "VAN-002",
    plate: "FAR 7820",
    carType: "Nissan Urvan 350",
    site: "Iloilo",
  },
  {
    vanNumber: "VAN-003",
    plate: "NHU 8001",
    carType: "Hi Ace Super Grandia",
    site: "Manila",
  },
  {
    vanNumber: "VAN-004",
    plate: "NII 6324",
    carType: "Hi Ace Super Grandia",
    site: "Manila",
  },
] as const;
