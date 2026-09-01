import { addPlainDays } from "@/lib/tz";
import type { ReservationSpec } from "@/modules/db/dev-seed/insert";
import type {
  ReservationStatus,
  RideMode,
  SiteLocation,
} from "@/modules/reservations/types";

/**
 * The dashboard's year of reservations, ported from the deleted
 * `getDevDashboardReservations` fixture. The PRIMARY rng (seed 0x5eed) draws
 * in exactly the original order so the statuses, modes, sites, and timings
 * reproduce the fixture's dataset; the ENRICH rng (seed 0xbead) feeds only
 * the fields the original never had (passengers, purpose, cost), so they
 * cannot shift the primary sequence.
 */

/** Deterministic PRNG (mulberry32) — stable output across runs and machines. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function weighted<T>(r: number, options: [T, number][]): T {
  const total = options.reduce((sum, [, weight]) => sum + weight, 0);
  let x = r * total;
  for (const [value, weight] of options) {
    x -= weight;
    if (x < 0) return value;
  }
  return options[options.length - 1][0];
}

const pad2 = (value: number): string => String(value).padStart(2, "0");

const REQUESTORS = [
  "Jimera, Arielle",
  "Dizon, Marco",
  "Reyes, Kaye",
  "Salcedo, Liza",
  "Mateo, Angel",
  "Cruz, Ivan",
];

// The fixture's pool named three drivers who never existed on the roster
// (Santos, Reyes Mark, Lim); assignments now carry a foreign key, so the
// pool is the roster's four ACTIVE drivers. Same draw count, real names.
const DRIVERS = [
  "Villanueva, Rey",
  "Ocampo, Dennis",
  "Sarmiento, Joel",
  "Padilla, Marlon",
];

// The four seeded vans (SEED_VANS); assigned alongside a driver, same as the
// roster pool above — every approved row now needs both.
const VANS = ["VAN-001", "VAN-002", "VAN-003", "VAN-004"];

// Long forms, matching the canonical dataset's own sample data (REQ-1051):
// "AGT" and "GLS" abbreviated the same two places to a different vocabulary.
const ROUTES: [string, string][] = [
  ["AGT Tower lobby", "GLS Building"],
  ["GLS Building", "AGT Tower lobby"],
  ["AGT Tower lobby", "Airport"],
  ["GLS Building", "Hotel"],
];

const TIMES = ["06:30", "07:00", "08:00", "09:30", "13:00", "17:30"];

const PASSENGER_POOL = [
  { domainId: "AJ29104", name: "Jimera, Arielle" },
  { domainId: "AM10394", name: "Dizon, Marco" },
  { domainId: "AK47281", name: "Reyes, Kaye" },
  { domainId: "AL55210", name: "Salcedo, Liza" },
  { domainId: "AG80017", name: "Mateo, Angel" },
];

const PICKUP_PURPOSES = [
  "Travel-Related (Airport Transfers)",
  "HR/TA Related",
  "IT-Related",
  "Others",
];

export function buildGeneratedReservations(): ReservationSpec[] {
  const rng = mulberry32(0x5eed);
  const enrich = mulberry32(0xbead);
  const pick = <T>(list: readonly T[]): T =>
    list[Math.floor(rng() * list.length)];
  const enrichPick = <T>(list: readonly T[]): T =>
    list[Math.floor(enrich() * list.length)];

  const specs: ReservationSpec[] = [];
  let seq = 2000;

  // Twelve months ending at 2026-08 (the fixtures' "today"): 2025-09 … 2026-08.
  for (let m = 0; m < 12; m++) {
    const monthIndex = 8 + m; // 8 = September, 0-based
    const year = 2025 + Math.floor(monthIndex / 12);
    const month0 = monthIndex % 12;
    const count = 14 + Math.floor(rng() * 12); // 14–25 requests per month

    for (let i = 0; i < count; i++) {
      // Primary draws, in the ORIGINAL fixture's exact order:
      const status = weighted<ReservationStatus>(rng(), [
        ["Approved", 60],
        ["Cancelled", 18],
        ["Pending", 12],
        ["Rejected", 10],
      ]);
      const mode = weighted<RideMode>(rng(), [
        ["pickup", 68],
        ["standby", 32],
      ]);
      const site = weighted<SiteLocation>(rng(), [
        ["Iloilo", 45],
        ["Manila", 55],
      ]);
      const day = 1 + Math.floor(rng() * 26); // 1–26
      const submitted = new Date(
        Date.UTC(
          year,
          month0,
          day,
          1 + Math.floor(rng() * 9),
          Math.floor(rng() * 60),
        ),
      );
      const [routeFrom, routeTo] = pick(ROUTES);
      const approved = status === "Approved";
      // ~88% within the 12h SLA; the rest breach it.
      const tatHours = rng() < 0.88 ? 0.5 + rng() * 11 : 12.5 + rng() * 22;
      const startTime = pick(TIMES);
      const requestor = pick(REQUESTORS);
      const driver = approved ? pick(DRIVERS) : null;
      const van = approved ? pick(VANS) : null;

      const startDate = `${year}-${pad2(month0 + 1)}-${pad2(Math.min(day + 4, 28))}`;
      const standby = mode === "standby";

      // The original emitted end 17:00 even for a 17:30 start; the CHECK
      // refuses that, so a late start pushes the block across midnight.
      const crossesMidnight = standby && startTime >= "17:00";
      const endDate = standby
        ? crossesMidnight
          ? (addPlainDays(startDate, 1) as string)
          : startDate
        : null;

      const acted =
        status === "Pending"
          ? null
          : new Date(submitted.getTime() + tatHours * 3_600_000);

      // Enrichment draws (second rng — cannot shift the primary sequence):
      const passengerCount = 1 + Math.floor(enrich() * 3); // 1–3
      const firstPassenger = Math.floor(enrich() * PASSENGER_POOL.length);
      const passengers = Array.from({ length: passengerCount }, (_, offset) => {
        const source =
          PASSENGER_POOL[(firstPassenger + offset) % PASSENGER_POOL.length];
        return { domainId: source.domainId, name: source.name };
      });
      const purpose = standby ? "Others" : enrichPick(PICKUP_PURPOSES);
      const costPhp = standby ? 3000 + Math.floor(enrich() * 60) * 100 : null;

      specs.push({
        key: `DSH-${seq++}`,
        mode,
        status,
        site,
        submittedAt: submitted.toISOString(),
        startDate,
        startTime,
        endDate,
        // A standby that crosses midnight ends the next day at 01:00, not at
        // the same wall-clock 17:00 it started before — that pair inverts
        // once endDate rolls over, reading as a 23.5-hour block instead of
        // the intended 7.5-hour one.
        endTime: standby ? (crossesMidnight ? "01:00" : "17:00") : null,
        requestor,
        requestorMobile: "09567567122",
        purpose,
        // A fixed string, not drawn from either rng: the primary sequence
        // reproduces the original fixture's exact draws, and the enrich
        // sequence's draw order feeds fields later in this object — either
        // one shifting would change every value downstream of it.
        details: "Generated dashboard seed trip.",
        pickupLocation: routeFrom,
        dropoffLocation: standby ? null : routeTo,
        towerHead: standby ? "Abanto, Norlyn" : null,
        vendor: standby ? "Metro Fleet Services" : null,
        costPhp,
        passengers,
        driver,
        van,
        actedBy: status === "Pending" ? null : "Abanto, Norlyn",
        actedAt: acted === null ? null : acted.toISOString(),
        modified: false,
        rejectionReason:
          status === "Rejected" ? "No van available on that date." : null,
        cancellationReason:
          status === "Cancelled" ? "Trip no longer needed." : null,
      });
    }
  }

  return specs;
}
