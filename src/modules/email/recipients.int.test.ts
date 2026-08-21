import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDb } from "@/modules/db/client";
import { adminRecipients } from "@/modules/email/recipients";

const db = getDb();

/** Prefixed so the cleanup below cannot touch a seeded or another suite's row. */
const MARK = "recipients-int";
const rows = [
  {
    full_name: `${MARK} Bea Iloilo`,
    email: "bea.iloilo@recipients.invalid",
    domain_id: "ZZ90001",
    site: "iloilo",
    notify: true,
    active: true,
  },
  {
    full_name: `${MARK} Cara Manila`,
    email: "cara.manila@recipients.invalid",
    domain_id: "ZZ90002",
    site: "manila",
    notify: true,
    active: true,
  },
  {
    full_name: `${MARK} Ana Both`,
    email: "ana.both@recipients.invalid",
    domain_id: "ZZ90003",
    site: "all",
    notify: true,
    active: true,
  },
  {
    full_name: `${MARK} Dan Muted`,
    email: "dan.muted@recipients.invalid",
    domain_id: "ZZ90004",
    site: "iloilo",
    notify: false,
    active: true,
  },
  {
    full_name: `${MARK} Eve Inactive`,
    email: "eve.inactive@recipients.invalid",
    domain_id: "ZZ90005",
    site: "iloilo",
    notify: true,
    active: false,
  },
  {
    full_name: `${MARK} Fay NoEmail`,
    email: null,
    domain_id: "ZZ90006",
    site: "iloilo",
    notify: true,
    active: true,
  },
];

const ours = (list: string[]) =>
  list.filter((email) => email.endsWith("@recipients.invalid"));

beforeAll(async () => {
  await db.insertInto("admin_whitelist").values(rows).execute();
});

// Row cleanup is a hard gate here: these suites share one database with
// fileParallelism off, so a leaked row breaks a LATER suite while this one
// still passes.
afterAll(async () => {
  await db
    .deleteFrom("admin_whitelist")
    .where("full_name", "like", `${MARK}%`)
    .execute();
  await db.destroy();
});

describe("adminRecipients", () => {
  it("drops the excluded address, case-insensitively", async () => {
    // An admin who books their own van must not be cc'd on their own approval.
    const list = ours(
      await adminRecipients(db, "Iloilo", "BEA.ILOILO@recipients.invalid"),
    );
    expect(list).toEqual(["ana.both@recipients.invalid"]);
  });

  it("returns the site's admins plus the 'all' admins, name-ordered", async () => {
    expect(ours(await adminRecipients(db, "Iloilo"))).toEqual([
      "ana.both@recipients.invalid",
      "bea.iloilo@recipients.invalid",
    ]);
  });

  it("scopes to the other site independently", async () => {
    expect(ours(await adminRecipients(db, "Manila"))).toEqual([
      "ana.both@recipients.invalid",
      "cara.manila@recipients.invalid",
    ]);
  });

  it("omits muted, inactive, and email-less rows", async () => {
    const iloilo = ours(await adminRecipients(db, "Iloilo"));
    for (const excluded of [
      "dan.muted@recipients.invalid",
      "eve.inactive@recipients.invalid",
    ]) {
      expect(iloilo).not.toContain(excluded);
    }
    // Fay has a Domain ID but no address: she can hold the admin role and still
    // be unreachable by mail.
    expect(iloilo).toHaveLength(2);
  });
});
