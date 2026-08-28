/**
 * TEST DATA — the design document's eight sample requests, frozen for unit
 * tests when the live app moved from fixtures to the database (the same
 * values now load via `pnpm db:seed:dev`). Pure-function tests want a stable
 * literal dataset, not whatever the seed evolves into.
 */
import type {
  AssignedDriver,
  AssignedVan,
  ReservationDetail,
  ReservationRow,
} from "@/modules/reservations/types";

/**
 * Every request in the system, which is what Admin Support sees.
 *
 * Requestor names vary deliberately. The requestor prototype's sample data is
 * all one person because it is that person's own list; carrying that into the
 * admin master list would leave its Requestor column showing one repeated name
 * and hide what the column is for.
 */
export function sampleAdminRequests(): ReservationRow[] {
  return [
    {
      id: "REQ-1051",
      submittedAt: "2026-08-03T01:12:00Z",
      startDate: "2026-08-08",
      startTime: "06:30",
      endTime: null,
      requestor: "Jimera, Arielle",
      site: "Iloilo",
      from: "AGT",
      to: "GLS",
      mode: "pickup",
      purpose: "Onshore/Client Visit",
      details: "Client walkthrough at the Smallville branch.",
      status: "Pending",
      updatedBy: null,
      updatedAt: null,
      remarks: "Changed Trip Details",
      driver: null,
      driverId: null,
      driverSource: null,
      vanLabel: null,
      vanSource: null,
      vanPlate: null,
    },
    {
      id: "REQ-1049",
      submittedAt: "2026-08-01T02:40:00Z",
      startDate: "2026-08-07",
      startTime: "08:00",
      endTime: null,
      requestor: "Jimera, Arielle",
      site: "Manila",
      from: "GLS",
      to: "AGT",
      mode: "pickup",
      purpose: "SLT Appointments",
      details: "Bringing the SLT to the Manila office for the townhall.",
      status: "Approved",
      updatedBy: "Abanto, Norlyn",
      updatedAt: "2026-08-04T09:20:00Z",
      remarks: null,
      driver: "Villanueva, Rey",
      driverId: "driver-villanueva-rey",
      driverSource: "roster",
      vanLabel: "VAN-01",
      vanSource: "roster",
      vanPlate: "NHU 8001",
    },
    {
      id: "REQ-1046",
      submittedAt: "2026-07-29T06:05:00Z",
      startDate: "2026-08-06",
      startTime: "09:00",
      endTime: null,
      requestor: "Jimera, Arielle",
      site: "Manila",
      from: "GLS",
      to: "AGT",
      mode: "pickup",
      purpose: "HR/TA Related",
      details: "Panel interview at the Manila office.",
      status: "Cancelled",
      updatedBy: "Buenaflor, Zara",
      updatedAt: "2026-08-05T02:10:00Z",
      remarks: null,
      driver: null,
      driverId: null,
      driverSource: null,
      vanLabel: null,
      vanSource: null,
      vanPlate: null,
    },
    {
      id: "REQ-1044",
      submittedAt: "2026-07-28T00:55:00Z",
      startDate: "2026-08-12",
      startTime: "07:15",
      endTime: null,
      requestor: "Dizon, Marco",
      site: "Manila",
      from: "GLS",
      to: "AGT",
      mode: "pickup",
      purpose: "IT-Related",
      details: "Transporting replacement workstations to the Manila office.",
      status: "Pending",
      updatedBy: null,
      updatedAt: null,
      remarks: null,
      driver: null,
      driverId: null,
      driverSource: null,
      vanLabel: null,
      vanSource: null,
      vanPlate: null,
    },
    {
      id: "REQ-1040",
      submittedAt: "2026-07-24T03:30:00Z",
      // Deliberately in the past relative to the design's "today" (Aug 05 2026),
      // so the Past Trips filter has something to show and its empty state is
      // not the only thing ever seen.
      startDate: "2026-08-02",
      startTime: "17:30",
      endTime: null,
      requestor: "Jimera, Arielle",
      site: "Manila",
      from: "GLS",
      to: "AGT",
      mode: "pickup",
      purpose: "Travel-Related (Airport Transfers)",
      details: "Airport pickup for a returning associate.",
      status: "Rejected",
      updatedBy: "Cruz, Ivan",
      updatedAt: "2026-08-06T01:45:00Z",
      remarks: null,
      driver: null,
      driverId: null,
      driverSource: null,
      vanLabel: null,
      vanSource: null,
      vanPlate: null,
    },
    {
      id: "REQ-1038",
      submittedAt: "2026-07-22T07:15:00Z",
      startDate: "2026-08-09",
      startTime: "10:00",
      endTime: "13:00",
      requestor: "Reyes, Kaye",
      site: "Manila",
      from: "GLS",
      to: "Standby",
      mode: "standby",
      purpose: "Official Company Event",
      details: "Van on standby for the Manila office anniversary event.",
      status: "Approved",
      updatedBy: "Abanto, Norlyn",
      updatedAt: "2026-08-06T07:30:00Z",
      remarks: null,
      driver: "Ocampo, Dennis",
      driverId: "driver-ocampo-dennis",
      driverSource: "roster",
      vanLabel: "VAN-02",
      vanSource: "roster",
      vanPlate: "NHU 8001",
    },
    {
      id: "REQ-1031",
      submittedAt: "2026-07-18T05:00:00Z",
      startDate: "2026-07-30",
      startTime: "07:00",
      endTime: "17:00",
      requestor: "Salcedo, Liza",
      site: "Iloilo",
      from: "AGT",
      to: "Standby",
      mode: "standby",
      purpose: "Team Building",
      details: "Van on call for the Iloilo team building offsite.",
      status: "Pending",
      updatedBy: null,
      updatedAt: null,
      remarks: "Changed Trip Details",
      driver: null,
      driverId: null,
      driverSource: null,
      vanLabel: null,
      vanSource: null,
      vanPlate: null,
    },
    {
      id: "REQ-1025",
      submittedAt: "2026-07-11T01:45:00Z",
      startDate: "2026-08-15",
      startTime: "13:00",
      endTime: "15:00",
      requestor: "Jimera, Arielle",
      site: "Manila",
      from: "GLS",
      to: "Standby",
      mode: "standby",
      purpose: "Finance Official Travel",
      details: "Van on standby for the quarter-end finance audit visits.",
      status: "Approved",
      updatedBy: "Buenaflor, Zara",
      updatedAt: "2026-08-07T03:15:00Z",
      remarks: null,
      driver: "Villanueva, Rey",
      driverId: "driver-villanueva-rey",
      driverSource: "roster",
      vanLabel: "VAN-03",
      vanSource: "roster",
      vanPlate: "NHU 8001",
    },
  ];
}

/**
 * The review detail for one request.
 *
 * Everything below the row itself is per-request data the fixture cannot know,
 * so it is derived from the row: a pickup gets pickup fields, a standby gets a
 * window and a costing, and a driver appears only once the request is Approved —
 * which matches the spec's own constraint that a reservation cannot reach
 * `approved` without an assigned driver.
 *
 * Returns null for an unknown reference so a caller has to handle the miss,
 * rather than rendering a drawer full of defaults for a request that does not
 * exist.
 */
export function sampleReservationDetail(id: string): ReservationDetail | null {
  const row = sampleAdminRequests().find((candidate) => candidate.id === id);
  if (row === undefined) return null;
  return reservationDetailFrom(row);
}

/**
 * The same derivation, for a row a test builds itself.
 *
 * Exported because the sample set above is all roster assignments, so the
 * rental branches of `assignedDriver`/`assignedVan` are otherwise unreachable
 * — and an untested fixture branch is how a fixture starts lying.
 */
export function reservationDetailFrom(row: ReservationRow): ReservationDetail {
  const standby = row.mode === "standby";

  return {
    ...row,
    requestorEmail: `${emailLocalPart(row.requestor)}@carelon.com`,
    requestorMobile: "09567567122",
    towerHead: standby ? "Abanto, Norlyn" : null,
    passengers: standby
      ? [
          { domainId: "AK47281", name: "Reyes, Kaye" },
          { domainId: "AM10394", name: "Dizon, Marco" },
          { domainId: "AL55210", name: "Salcedo, Liza" },
          { domainId: "AG80017", name: "Mateo, Angel" },
        ]
      : [
          { domainId: "AJ29104", name: "Jimera, Arielle" },
          { domainId: "AM10394", name: "Dizon, Marco" },
        ],
    pickupPoint: `${row.from} Tower lobby`,
    dropoffPoint: standby ? null : `${row.to} Building`,
    endDate: standby ? row.startDate : null,
    vendor: standby ? "Metro Fleet Services" : null,
    costPhp: standby ? 6400 : null,
    assignedDriver: assignedDriverFrom(row),
    assignedVan: assignedVanFrom(row),
    rejectionReason:
      row.status === "Rejected" ? "No van available on that date." : null,
    // A row an admin has already acted on has been written at least twice.
    version: row.updatedBy === null ? 1 : 2,
  };
}

/**
 * Branches on `driverSource`, not on `driverId`: a rental row has a driver and
 * no id by design, and keying on the id would render it driverless — the exact
 * misreading `ReservationRow.driverId`'s own comment warns about.
 *
 * The roster branch reads `row.driverId` rather than re-deriving the slug: two
 * copies of one id in a single fixture is how they drift apart.
 */
function assignedDriverFrom(row: ReservationRow): AssignedDriver | null {
  if (row.driver === null || row.driverSource === null) return null;
  if (row.driverSource === "rental") {
    return { source: "rental", name: row.driver, mobile: "09171234567" };
  }
  if (row.driverId === null) return null;
  return {
    source: "roster",
    id: row.driverId,
    name: row.driver,
    mobile: "09171234567",
    shift: "11AM-11PM",
  };
}

/**
 * Same branching rule. A rental van gets no id — it has no fleet row, so there
 * is nothing to invent one from — and its label becomes the plate, not the van
 * number: the row carries one string, and `vanLabel` falls back to the plate,
 * so reading it back as the plate is the only lossless choice.
 *
 * Adding a rental sample row: set its `vanLabel` to the rental's plate (with
 * `vanNumber: null`), never its van number — `vanLabel` collapses three
 * sources into one string and cannot be reversed to recover which one it was.
 */
function assignedVanFrom(row: ReservationRow): AssignedVan | null {
  if (row.vanLabel === null || row.vanSource === null) return null;
  if (row.vanSource === "rental") {
    return {
      source: "rental",
      vanNumber: null,
      plate: row.vanLabel,
      carType: "Toyota GL",
    };
  }
  return {
    source: "roster",
    id: `van-${slug(row.vanLabel)}`,
    vanNumber: row.vanLabel,
    plate: "NHU 8001",
    carType: "Hi Ace Super Grandia",
  };
}

/** `"Villanueva, Rey"` → `"villanueva-rey"`, so a fixture driver has a stable key. */
function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** `"Jimera, Arielle"` → `"arielle.jimera"`. */
function emailLocalPart(name: string): string {
  const [last = "", first = ""] = name.split(",").map((part) => part.trim());
  return [first, last]
    .filter((part) => part !== "")
    .join(".")
    .toLowerCase()
    .replace(/\s+/g, "");
}
