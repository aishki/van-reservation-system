import { sql } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import {
  createAdmin,
  isSuperAdmin,
  listAdmins,
  setAdminActive,
  updateAdmin,
} from "@/modules/admins/repo";
import type { RoleIdentity } from "@/modules/auth/roles";
import type { RosterActor } from "@/modules/roster/types";
import { testDb } from "../../../test/with-rollback";

const db = testDb();

/** Every row this suite creates carries it, so cleanup finds them all. */
const MARK = "admins-int";

/**
 * The acting super-admin.
 *
 * `userId` is null rather than a seeded user: `roster_events.actor_user_id`
 * references `users.id`, and null satisfies the FK by absence.
 *
 * `domainId` is what the self-lockout guardrails match on — NOT an id. The two
 * tables' ids are unrelated, so an id comparison would never fire.
 */
const ACTOR: RosterActor = {
  userId: null,
  domainId: "ZZACTOR",
  email: "actor@x.invalid",
  name: "Jimera, Arielle",
  role: "admin_support",
};

afterEach(async () => {
  await sql`delete from roster_events where actor_name = ${ACTOR.name}`.execute(
    db,
  );
  await sql`delete from admin_whitelist where full_name like ${`${MARK}%`}`.execute(
    db,
  );
});

const input = (suffix: string, overrides = {}) => ({
  fullName: `${MARK} ${suffix}`,
  email: `${MARK}-${suffix}@x.invalid`,
  domainId: `ZZ${suffix}`,
  site: "all" as const,
  notify: true,
  superAdmin: false,
  ...overrides,
});

type Demotion = Awaited<ReturnType<typeof updateAdmin>>;

/** The `RoleIdentity` `isSuperAdmin` now takes, for a row this suite created. */
const identity = (suffix: string, overrides: Partial<RoleIdentity> = {}) => ({
  domainId: `ZZ${suffix}`,
  email: `${MARK}-${suffix}@x.invalid`,
  ...overrides,
});

/**
 * Blocks until `n` backends are waiting on a lock.
 *
 * Polling the server beats sleeping a fixed interval: the point is that both
 * demotions have genuinely reached their lock wait, and a timeout that is
 * generous on this machine is a flake on a loaded CI runner.
 */
async function waitForBlockedBackends(n: number): Promise<void> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const row = await sql<{ n: string | number }>`
      select count(*) as n from pg_stat_activity
      where datname = current_database() and wait_event_type = 'Lock'
    `.execute(db);
    if (Number(row.rows[0]?.n ?? 0) >= n) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`only saw fewer than ${n} blocked backends`);
}

/**
 * Isolating this needs the SEEDED holders out of the way, since the seed
 * grants two. Deactivate them for the duration and restore in a finally, so a
 * failure here cannot leave the real whitelist without a manager.
 */
async function withOnlySeededHoldersDisabled(
  body: () => Promise<void>,
): Promise<void> {
  const holders = await db
    .selectFrom("admin_whitelist")
    .select("id")
    .where("super_admin", "=", true)
    .where("full_name", "not like", `${MARK}%`)
    .execute();
  const ids = holders.map((h) => h.id);
  if (ids.length > 0) {
    await db
      .updateTable("admin_whitelist")
      .set({ super_admin: false })
      .where("id", "in", ids)
      .execute();
  }
  try {
    await body();
  } finally {
    if (ids.length > 0) {
      await db
        .updateTable("admin_whitelist")
        .set({ super_admin: true })
        .where("id", "in", ids)
        .execute();
    }
  }
}

describe("createAdmin", () => {
  it("creates the row and logs a created event", async () => {
    const created = await createAdmin(db, input("01"), ACTOR);
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const events = await db
      .selectFrom("roster_events")
      .selectAll()
      .where("target_id", "=", created.value.id)
      .execute();
    expect(events).toHaveLength(1);
    expect(events[0].target_table).toBe("admin_whitelist");
  });

  it("refuses a duplicate email, naming the email field", async () => {
    await createAdmin(db, input("02"), ACTOR);
    const second = await createAdmin(
      db,
      input("03", { email: `${MARK}-02@x.invalid` }),
      ACTOR,
    );
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error.field).toBe("email");
  });

  it("refuses a duplicate domain id, naming the domainId field", async () => {
    await createAdmin(db, input("04"), ACTOR);
    const second = await createAdmin(
      db,
      input("05", { domainId: "ZZ04" }),
      ACTOR,
    );
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error.field).toBe("domainId");
  });
});

describe("updateAdmin", () => {
  it("logs an updated event carrying the diff", async () => {
    const created = await createAdmin(db, input("06"), ACTOR);
    if (!created.ok) throw new Error("setup failed");

    const result = await updateAdmin(
      db,
      created.value.id,
      { site: "iloilo", notify: false },
      ACTOR,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.site).toBe("iloilo");

    const events = await db
      .selectFrom("roster_events")
      .select(["event_type", "changes"])
      .where("target_id", "=", created.value.id)
      .where("event_type", "=", "updated")
      .execute();
    expect(events).toHaveLength(1);
    // Wrapped in `{ fields }` — the shape `parseChanges` reads, matching
    // `reservation_events`. A bare array is rejected by its first line.
    expect(events[0].changes).toEqual({
      fields: [
        { field: "site", label: "Site", from: "all", to: "iloilo" },
        {
          field: "notify",
          label: "Receives notifications",
          from: "Yes",
          to: "No",
        },
      ],
    });
  });

  it("logs NO event when the patch changes nothing", async () => {
    const created = await createAdmin(db, input("07"), ACTOR);
    if (!created.ok) throw new Error("setup failed");

    const result = await updateAdmin(
      db,
      created.value.id,
      { site: "all" },
      ACTOR,
    );
    expect(result.ok).toBe(true);

    const events = await db
      .selectFrom("roster_events")
      .select("event_type")
      .where("target_id", "=", created.value.id)
      .execute();
    expect(events.map((e) => e.event_type)).toEqual(["created"]);
  });

  it("refuses a patch that would leave the row with neither key", async () => {
    // The DB's identity CHECK would reject this anyway; caught here so the user
    // gets a named field instead of a 500.
    const created = await createAdmin(
      db,
      input("13", { domainId: "ZZ13", email: null }),
      ACTOR,
    );
    if (!created.ok) throw new Error("setup failed");

    const result = await updateAdmin(
      db,
      created.value.id,
      { domainId: null },
      ACTOR,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.field).toBe("email");
  });

  it("allows nulling ONE key when the other survives", async () => {
    const created = await createAdmin(
      db,
      input("14", { domainId: "ZZ14" }),
      ACTOR,
    );
    if (!created.ok) throw new Error("setup failed");

    // Row keeps its Domain ID, so dropping the email is legal.
    const result = await updateAdmin(
      db,
      created.value.id,
      { email: null },
      ACTOR,
    );
    expect(result.ok).toBe(true);
  });
});

describe("guardrail: nobody may clear their own super_admin", () => {
  it("refuses when the actor is the row's own identity", async () => {
    // Otherwise the last competent person can lock themselves out with one
    // mis-click, and only a deploy gets them back.
    // The actor's OWN row, identified by Domain ID.
    const created = await createAdmin(
      db,
      input("10", { superAdmin: true, domainId: ACTOR.domainId }),
      ACTOR,
    );
    if (!created.ok) throw new Error("setup failed");

    const result = await updateAdmin(
      db,
      created.value.id,
      { superAdmin: false },
      ACTOR,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("FORBIDDEN");
    expect(result.error.message).toContain("your own");
  });

  it("refuses when only the EMAIL matches — a mistyped Domain ID is still them", async () => {
    // `matchWhitelist` lets Domain ID short-circuit the email because it picks
    // one winner among many rows. Copying that here made the guardrail miss a
    // row whose `domain_id` is a typo but whose email signs the actor in.
    const created = await createAdmin(
      db,
      input("15", { superAdmin: true, domainId: "ZZTYPO", email: ACTOR.email }),
      ACTOR,
    );
    if (!created.ok) throw new Error("setup failed");

    const result = await updateAdmin(
      db,
      created.value.id,
      { superAdmin: false },
      ACTOR,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("FORBIDDEN");
  });
});

describe("guardrail: nobody may deactivate their own row", () => {
  it("refuses a self-deactivation", async () => {
    const created = await createAdmin(
      db,
      input("11", { domainId: ACTOR.domainId }),
      ACTOR,
    );
    if (!created.ok) throw new Error("setup failed");

    const result = await setAdminActive(db, created.value.id, false, ACTOR);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("FORBIDDEN");
  });

  /**
   * REGRESSION GUARD for the defect this plan originally shipped: comparing
   * `admin_whitelist.id` to `users.id`. Those are different tables, so the
   * comparison is always false and BOTH self-lockout guardrails silently never
   * fire — while a test that passes a whitelist id as `userId` still goes green.
   *
   * This case pins the opposite direction: a row that is NOT the actor's must
   * still be deactivable, so the identity match cannot be made unconditionally
   * true to satisfy the two cases above.
   */
  it("refuses when only the EMAIL matches, here too", async () => {
    const created = await createAdmin(
      db,
      input("16", { domainId: "ZZTYPO2", email: ACTOR.email }),
      ACTOR,
    );
    if (!created.ok) throw new Error("setup failed");

    const result = await setAdminActive(db, created.value.id, false, ACTOR);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("FORBIDDEN");
  });

  it("still allows deactivating somebody ELSE'S row", async () => {
    const other = await createAdmin(
      db,
      input("12", { domainId: "ZZ12" }),
      ACTOR,
    );
    if (!other.ok) throw new Error("setup failed");

    const result = await setAdminActive(db, other.value.id, false, ACTOR);
    expect(result.ok).toBe(true);
  });
});

describe("guardrail: the last super-admin cannot be removed", () => {
  it("refuses to demote the only holder", async () => {
    await withOnlySeededHoldersDisabled(async () => {
      const only = await createAdmin(
        db,
        input("20", { superAdmin: true, domainId: "ZZ20" }),
        ACTOR,
      );
      if (!only.ok) throw new Error("setup failed");

      const result = await updateAdmin(
        db,
        only.value.id,
        { superAdmin: false },
        ACTOR,
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain("At least one person");
    });
  });

  it("refuses to deactivate the only holder", async () => {
    await withOnlySeededHoldersDisabled(async () => {
      const only = await createAdmin(
        db,
        input("21", { superAdmin: true, domainId: "ZZ21" }),
        ACTOR,
      );
      if (!only.ok) throw new Error("setup failed");

      const result = await setAdminActive(db, only.value.id, false, ACTOR);
      expect(result.ok).toBe(false);
    });
  });

  it("ALLOWS demoting one of two holders", async () => {
    await withOnlySeededHoldersDisabled(async () => {
      const first = await createAdmin(
        db,
        input("22", { superAdmin: true, domainId: "ZZ22" }),
        ACTOR,
      );
      await createAdmin(
        db,
        input("23", { superAdmin: true, domainId: "ZZ23" }),
        ACTOR,
      );
      if (!first.ok) throw new Error("setup failed");

      const result = await updateAdmin(
        db,
        first.value.id,
        { superAdmin: false },
        ACTOR,
      );
      expect(result.ok).toBe(true);
    });
  });

  it("counts only ACTIVE holders — an inactive one manages nothing", async () => {
    await withOnlySeededHoldersDisabled(async () => {
      const active = await createAdmin(
        db,
        input("24", { superAdmin: true, domainId: "ZZ24" }),
        ACTOR,
      );
      const inactive = await createAdmin(
        db,
        input("25", { superAdmin: true, domainId: "ZZ25" }),
        ACTOR,
      );
      if (!active.ok || !inactive.ok) throw new Error("setup failed");
      await setAdminActive(db, inactive.value.id, false, ACTOR);

      // One ACTIVE holder remains, so demoting them must be refused even though
      // two rows carry the flag.
      const result = await updateAdmin(
        db,
        active.value.id,
        { superAdmin: false },
        ACTOR,
      );
      expect(result.ok).toBe(false);
    });
  });

  it("ALLOWS demoting an already-INACTIVE holder while an active one remains", async () => {
    // Symmetry with `setAdminActive`, which only counts a deactivation as
    // losing a holder when the row was active. An inactive holder was never in
    // `activeHolderCount`, so demoting them sheds nothing.
    await withOnlySeededHoldersDisabled(async () => {
      await createAdmin(
        db,
        input("28", { superAdmin: true, domainId: "ZZ28" }),
        ACTOR,
      );
      const shelved = await createAdmin(
        db,
        input("29", { superAdmin: true, domainId: "ZZ29" }),
        ACTOR,
      );
      if (!shelved.ok) throw new Error("setup failed");
      await setAdminActive(db, shelved.value.id, false, ACTOR);

      const result = await updateAdmin(
        db,
        shelved.value.id,
        { superAdmin: false },
        ACTOR,
      );
      expect(result.ok).toBe(true);
    });
  });

  it("holds under two CONCURRENT demotions of two holders", async () => {
    // The race `lockHolderCount` exists for: both transactions read "two
    // holders", both allow, and zero remain. One must lose.
    //
    // Launching the two calls with a bare `Promise.all` is NOT enough to
    // produce the race — measured: the second transaction spends longer opening
    // a pool connection than the first spends running end to end, so they never
    // overlap and the test passes however broken the repo is. Both are instead
    // parked on a row lock held by a third transaction and released together.
    await withOnlySeededHoldersDisabled(async () => {
      const a = await createAdmin(
        db,
        input("26", { superAdmin: true, domainId: "ZZ26" }),
        ACTOR,
      );
      const b = await createAdmin(
        db,
        input("27", { superAdmin: true, domainId: "ZZ27" }),
        ACTOR,
      );
      if (!a.ok || !b.ok) throw new Error("setup failed");

      let pending: Promise<[Demotion, Demotion]> | null = null;
      await db.transaction().execute(async (gate) => {
        await gate
          .selectFrom("admin_whitelist")
          .select("id")
          .where("id", "in", [a.value.id, b.value.id])
          .forUpdate()
          .execute();

        pending = Promise.all([
          updateAdmin(db, a.value.id, { superAdmin: false }, ACTOR),
          updateAdmin(db, b.value.id, { superAdmin: false }, ACTOR),
        ]);
        try {
          await waitForBlockedBackends(2);
        } catch (error) {
          // Both demotions unblock when this transaction ends. Attach a handler
          // now, or the waiter's named timeout is buried under an unhandled
          // rejection from the promise nobody awaited.
          pending.catch(() => {});
          throw error;
        }
      });

      const [ra, rb] = await (pending as unknown as Promise<
        [Demotion, Demotion]
      >);

      // Exactly one succeeds.
      expect([ra.ok, rb.ok].filter(Boolean)).toHaveLength(1);

      const remaining = await db
        .selectFrom("admin_whitelist")
        .select(db.fn.countAll().as("n"))
        .where("super_admin", "=", true)
        .where("active", "=", true)
        .executeTakeFirstOrThrow();
      expect(Number(remaining.n)).toBeGreaterThanOrEqual(1);
    });
  });
});

describe("listAdmins", () => {
  it("includes INACTIVE rows — the log has to name whose access was removed", async () => {
    const created = await createAdmin(
      db,
      input("40", { domainId: "ZZ40" }),
      ACTOR,
    );
    if (!created.ok) throw new Error("setup failed");
    await setAdminActive(db, created.value.id, false, ACTOR);

    const rows = await listAdmins(db);
    const found = rows.find((r) => r.id === created.value.id);
    expect(found?.active).toBe(false);
  });
});

describe("isSuperAdmin", () => {
  it("is true for an active holder", async () => {
    await createAdmin(
      db,
      input("30", { superAdmin: true, domainId: "ZZ30" }),
      ACTOR,
    );
    expect(await isSuperAdmin(db, identity("30"))).toBe(true);
  });

  /**
   * REGRESSION GUARD for a lockout that slips past all four guardrails:
   * clearing the last holder's Domain ID is not a demotion, does not touch
   * `active`, and leaves the row with its email — so nothing refuses it, and a
   * Domain-ID-only lookup then finds no holder at all while the count still
   * says one. The capability becomes unreachable with no way back but a deploy.
   *
   * Closed by reading through the SAME matcher login uses, so reachability and
   * sign-in cannot disagree.
   */
  it("survives the last holder losing their Domain ID, via their email", async () => {
    await withOnlySeededHoldersDisabled(async () => {
      const only = await createAdmin(
        db,
        input("50", { superAdmin: true, domainId: "ZZ50" }),
        ACTOR,
      );
      if (!only.ok) throw new Error("setup failed");

      const cleared = await updateAdmin(
        db,
        only.value.id,
        { domainId: null },
        ACTOR,
      );
      expect(cleared.ok).toBe(true);

      expect(await isSuperAdmin(db, identity("50", { domainId: "" }))).toBe(
        true,
      );
    });
  });

  it("is true for an email-only holder", async () => {
    await createAdmin(
      db,
      input("51", { superAdmin: true, domainId: null }),
      ACTOR,
    );
    expect(await isSuperAdmin(db, identity("51", { domainId: "ZZ51" }))).toBe(
      true,
    );
  });

  it("is false once the holder is deactivated", async () => {
    // This is the whole reason the routes re-read instead of trusting a cookie.
    // A second holder exists so guardrail 3 does not refuse the deactivation —
    // the test database carries no seeded whitelist, only what runs here.
    await createAdmin(
      db,
      input("32", { superAdmin: true, domainId: "ZZ32" }),
      ACTOR,
    );
    const created = await createAdmin(
      db,
      input("31", { superAdmin: true, domainId: "ZZ31" }),
      ACTOR,
    );
    if (!created.ok) throw new Error("setup failed");
    const off = await setAdminActive(db, created.value.id, false, ACTOR);
    expect(off.ok).toBe(true);

    expect(await isSuperAdmin(db, identity("31"))).toBe(false);
  });

  it("is false for an unknown identity", async () => {
    expect(
      await isSuperAdmin(db, { domainId: "NOBODY", email: "nobody@x.invalid" }),
    ).toBe(false);
  });
});

/**
 * An audit row for a change that did not happen makes the whole log
 * untrustworthy — the same rule `updateAdmin` applies to an empty diff. The
 * roster table computes `!row.active` from cached query data, so a stale table
 * deactivates a row that is already off.
 */
describe("setAdminActive: no event when the value is unchanged", () => {
  const eventTypes = (id: string) =>
    db
      .selectFrom("roster_events")
      .select("event_type")
      .where("target_id", "=", id)
      .orderBy("created_at", "asc")
      .orderBy("id", "asc")
      .execute();

  it("deactivating an already-inactive row writes nothing", async () => {
    const created = await createAdmin(
      db,
      input("40", { domainId: "ZZ40" }),
      ACTOR,
    );
    if (!created.ok) throw new Error("setup failed");

    await setAdminActive(db, created.value.id, false, ACTOR);
    const again = await setAdminActive(db, created.value.id, false, ACTOR);

    expect(again.ok).toBe(true);
    expect(
      (await eventTypes(created.value.id)).map((t) => t.event_type),
    ).toEqual(["created", "deactivated"]);
  });

  // The writer half of the seed's `humanManagedIds` filter: that filter looks
  // for `reactivated`, and `admin-whitelist-seed-runner.int.test.ts` inserts
  // the event by hand, so this is what keeps the two spellings honest.
  it("a real reactivation writes an event of type reactivated", async () => {
    const created = await createAdmin(
      db,
      input("43", { domainId: "ZZ43" }),
      ACTOR,
    );
    if (!created.ok) throw new Error("setup failed");

    await setAdminActive(db, created.value.id, false, ACTOR);
    const back = await setAdminActive(db, created.value.id, true, ACTOR);
    expect(back.ok).toBe(true);

    expect(
      (await eventTypes(created.value.id)).map((t) => t.event_type),
    ).toEqual(["created", "deactivated", "reactivated"]);
  });

  it("reactivating an already-active row writes nothing", async () => {
    const created = await createAdmin(
      db,
      input("41", { domainId: "ZZ41" }),
      ACTOR,
    );
    if (!created.ok) throw new Error("setup failed");

    const again = await setAdminActive(db, created.value.id, true, ACTOR);

    expect(again.ok).toBe(true);
    expect(
      (await eventTypes(created.value.id)).map((t) => t.event_type),
    ).toEqual(["created"]);
  });

  // The short-circuit sits AFTER the guardrails: a refusal must stay a refusal
  // even when the write it refuses would have changed nothing.
  it("still refuses self-deactivation of a row that is already inactive", async () => {
    const own = await createAdmin(
      db,
      input("42", { domainId: ACTOR.domainId, email: ACTOR.email }),
      ACTOR,
    );
    if (!own.ok) throw new Error("setup failed");
    // Switched off out of band — guardrail 2 refuses every route that would
    // get it there through the repo.
    await db
      .updateTable("admin_whitelist")
      .set({ active: false })
      .where("id", "=", own.value.id)
      .execute();

    const result = await setAdminActive(db, own.value.id, false, ACTOR);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("FORBIDDEN");
  });
});
