import type { Kysely } from "kysely";
import type { DB } from "@/modules/db/types";

/**
 * The client's real fleet — eight drivers, four vans, supplied 2026-08-27.
 *
 * The client's sheet records a SUB-site per row (ILO-OFT, ILO-SMS, MNL-AGT,
 * MNL-GLS); the suffix is dropped BY DECISION, not oversight. `site` keeps
 * the project's two-value vocabulary ('iloilo' | 'manila') used everywhere
 * else — do not "restore" the suffix without re-reading the spec.
 *
 * The four Iloilo shifts are genuinely unknown — "null for now" in the
 * client's own sheet, not a gap in this seed.
 */

const VANS = [
  {
    van_number: "VAN-001",
    plate: "FAR 8931",
    car_type: "Toyota GL",
    site: "iloilo",
  },
  {
    van_number: "VAN-002",
    plate: "FAR 7820",
    car_type: "Nissan Urvan 350",
    site: "iloilo",
  },
  {
    van_number: "VAN-003",
    plate: "NHU 8001",
    car_type: "Hi Ace Super Grandia",
    site: "manila",
  },
  {
    van_number: "VAN-004",
    plate: "NII 6324",
    car_type: "Hi Ace Super Grandia",
    site: "manila",
  },
] as const;

// Mobiles exactly as supplied: 10 digits, no leading zero. Names are
// "First Last" — the client's own format.
const DRIVERS = [
  {
    name: "Ronald Japitana",
    mobile: "9063353656",
    site: "iloilo",
    shift: null,
  },
  { name: "Paul Zonio", mobile: "9165296359", site: "iloilo", shift: null },
  {
    name: "Jayrold Aurelio",
    mobile: "9919653178",
    site: "iloilo",
    shift: null,
  },
  { name: "John Dapulang", mobile: "9941326282", site: "iloilo", shift: null },
  {
    name: "Ian Aduana",
    mobile: "9179694454",
    site: "manila",
    shift: "11AM-11PM",
  },
  {
    name: "Wally Dimaapi",
    mobile: "9982542714",
    site: "manila",
    shift: "11AM-11PM",
  },
  {
    name: "Ronie Avila",
    mobile: "9958912991",
    site: "manila",
    shift: "11PM-11AM",
  },
  {
    name: "Khristian Alexis Miguel",
    mobile: "9272549429",
    site: "manila",
    shift: "11PM-11AM",
  },
] as const;

/**
 * Idempotent. Vans upsert via `onConflict` on `van_number` (unique, like the
 * admin_whitelist seed's pattern). `drivers` has no unique constraint on
 * `name`, so onConflict has no arbiter there — each row is guarded with an
 * existence check and update-or-insert instead.
 *
 * THIS SEED IS NO LONGER THESE TABLES' ONLY WRITER. `/roster` gives every
 * Admin Support member add/edit/deactivate over drivers and vans, so neither
 * branch below writes `active`. Both used to force it back to `true`, with a
 * comment saying it would surprise whoever added a retire button — that
 * button shipped, and the surprise would be a van an operator deliberately
 * retired quietly back in the assignment dropdown after the next deploy.
 *
 * A brand-new row still starts active: the column defaults to true, and this
 * seed only ever declines to CHANGE the flag. Retiring and un-retiring are
 * `/roster` actions now, and they are the only things that write `active`,
 * which is also what keeps `roster_events` a complete record of it.
 *
 * The seeded FIELDS are still corrected on every run — plate, car type, site,
 * mobile, shift — so a typo is fixed by editing the data here and re-seeding.
 */
export async function seed(db: Kysely<DB>): Promise<void> {
  for (const van of VANS) {
    await db
      .insertInto("vans")
      .values(van)
      .onConflict((oc) =>
        oc.column("van_number").doUpdateSet({
          plate: van.plate,
          car_type: van.car_type,
          site: van.site,
        }),
      )
      .execute();
  }

  for (const driver of DRIVERS) {
    // Identity assumption: `name` is the only handle available (`drivers`
    // has no unique constraint to upsert against), so two drivers sharing a
    // name would silently overwrite whichever row Postgres returns first —
    // no error, no duplicate. Acceptable because the real roster's eight
    // names are distinct; revisit if that ever stops being true.
    const existing = await db
      .selectFrom("drivers")
      .select("id")
      .where("name", "=", driver.name)
      .executeTakeFirst();

    if (existing === undefined) {
      await db.insertInto("drivers").values(driver).execute();
    } else {
      await db
        .updateTable("drivers")
        .set({
          mobile: driver.mobile,
          site: driver.site,
          shift: driver.shift,
        })
        .where("id", "=", existing.id)
        .execute();
    }
  }
}
