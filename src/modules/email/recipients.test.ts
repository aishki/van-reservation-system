import { describe, expect, it } from "vitest";
import { ADMIN_WHITELIST_SEED } from "@/modules/auth/admin-whitelist-seed";
import {
  type NotifiableAdmin,
  selectAdminEmails,
} from "@/modules/email/recipients";

const rows: NotifiableAdmin[] = [
  { full_name: "Bea Iloilo", email: "bea@x.test", site: "iloilo" },
  { full_name: "Cara Manila", email: "cara@x.test", site: "manila" },
  { full_name: "Ana Both", email: "ana@x.test", site: "all" },
  {
    full_name: "Dan Muted",
    email: "dan@x.test",
    site: "iloilo",
    notify: false,
  },
  {
    full_name: "Eve Inactive",
    email: "eve@x.test",
    site: "iloilo",
    active: false,
  },
  { full_name: "Fay NoEmail", email: null, site: "iloilo" },
];

describe("selectAdminEmails", () => {
  it("takes the site's admins plus the 'all' rows, name-ordered", () => {
    expect(selectAdminEmails(rows, "Iloilo")).toEqual([
      "ana@x.test",
      "bea@x.test",
    ]);
    expect(selectAdminEmails(rows, "Manila")).toEqual([
      "ana@x.test",
      "cara@x.test",
    ]);
  });

  it("drops muted, inactive, and email-less rows", () => {
    const iloilo = selectAdminEmails(rows, "Iloilo");
    for (const gone of ["dan@x.test", "eve@x.test"]) {
      expect(iloilo).not.toContain(gone);
    }
  });

  it("treats an absent notify/active as true, so a seed row counts", () => {
    // ADMIN_WHITELIST_SEED rows carry neither column; the table defaults both.
    expect(
      selectAdminEmails(
        [{ full_name: "G", email: "g@x.test", site: "all" }],
        "Iloilo",
      ),
    ).toEqual(["g@x.test"]);
  });

  it("excludes one address case-insensitively", () => {
    expect(selectAdminEmails(rows, "Iloilo", "BEA@X.TEST")).toEqual([
      "ana@x.test",
    ]);
  });

  it("resolves the real seed, and never copies the requestor to themselves", () => {
    // Arielle is an 'all' admin AND books vans, so she must not appear.
    const cc = selectAdminEmails(
      ADMIN_WHITELIST_SEED,
      "Iloilo",
      "arielle.jimera@carelon.com",
    );
    expect(cc).not.toContain("arielle.jimera@carelon.com");
    expect(cc).toContain("ivy.balandra@carelon.com");
    // Manila-only admins stay out of an Iloilo booking's notifications.
    expect(cc).not.toContain("zarracrist.bartolo@carelon.com");
  });
});
