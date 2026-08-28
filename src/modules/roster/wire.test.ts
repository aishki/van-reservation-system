import { describe, expect, it } from "vitest";
import {
  activeSchema,
  adminCreateSchema,
  adminPatchSchema,
  driverCreateSchema,
  driverPatchSchema,
  fieldForConstraint,
  vanCreateSchema,
  vanPatchSchema,
} from "@/modules/roster/wire";

describe("driverCreateSchema", () => {
  const valid = {
    name: "Ronald Japitana",
    mobile: "09171234567",
    site: "Iloilo",
    shift: null,
  };

  it("accepts a complete driver", () => {
    expect(driverCreateSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects a site outside SITE_LOCATIONS", () => {
    // Drivers use the title-case fleet vocabulary. "all" is an ADMIN site and
    // must not be accepted here — the vans/drivers CHECK constraints reject it.
    expect(
      driverCreateSchema.safeParse({ ...valid, site: "all" }).success,
    ).toBe(false);
  });

  it("rejects a blank name rather than storing whitespace", () => {
    expect(
      driverCreateSchema.safeParse({ ...valid, name: "   " }).success,
    ).toBe(false);
  });

  it("trims the values it accepts", () => {
    const parsed = driverCreateSchema.parse({ ...valid, name: "  Ronald  " });
    expect(parsed.name).toBe("Ronald");
  });

  it("accepts a null shift — Iloilo drivers have none", () => {
    expect(driverCreateSchema.parse(valid).shift).toBeNull();
  });
});

describe("driverPatchSchema", () => {
  it("accepts a patch carrying one field", () => {
    // A PATCH carries only what moved; requiring every field would make the
    // client resend values it never touched.
    expect(driverPatchSchema.safeParse({ mobile: "09990001111" }).success).toBe(
      true,
    );
  });

  it("rejects an empty patch, which would write nothing and log an event", () => {
    expect(driverPatchSchema.safeParse({}).success).toBe(false);
  });

  it("still validates the fields it is given", () => {
    expect(driverPatchSchema.safeParse({ site: "all" }).success).toBe(false);
  });

  it("rejects a blank shift, exactly as the create schema does", () => {
    // The override exists to drop `.default(null)` — it must not also drop
    // `.trim().min(1)`, or a PATCH becomes looser than a POST.
    expect(driverPatchSchema.safeParse({ shift: "   " }).success).toBe(false);
  });

  it("rejects a body mixing activation with a field change", () => {
    // Two different events in the log; the client must send two requests.
    expect(
      driverPatchSchema.safeParse({ active: false, mobile: "09990001111" })
        .success,
    ).toBe(false);
  });

  it("rejects an unknown key rather than silently ignoring it", () => {
    // Without `.strict()` this parses as `{mobile}` and the caller is told the
    // save succeeded while `shiftt` was discarded.
    expect(
      driverPatchSchema.safeParse({
        mobile: "09990001111",
        shiftt: "11AM-11PM",
      }).success,
    ).toBe(false);
  });
});

describe("vanPatchSchema", () => {
  it("accepts a patch carrying one field", () => {
    expect(vanPatchSchema.safeParse({ plate: "ABC 1234" }).success).toBe(true);
  });

  it("rejects an empty patch, which would write nothing and log an event", () => {
    expect(vanPatchSchema.safeParse({}).success).toBe(false);
  });

  it("rejects a body mixing activation with a field change", () => {
    expect(
      vanPatchSchema.safeParse({ active: false, plate: "ABC 1234" }).success,
    ).toBe(false);
  });

  it("rejects an unknown key rather than silently ignoring it", () => {
    expect(
      vanPatchSchema.safeParse({ plate: "ABC 1234", plates: "ABC 1234" })
        .success,
    ).toBe(false);
  });
});

describe("activeSchema", () => {
  it("accepts a bare activation toggle", () => {
    expect(activeSchema.safeParse({ active: false }).success).toBe(true);
  });

  it("rejects a body mixing activation with a field change", () => {
    expect(
      activeSchema.safeParse({ active: false, mobile: "09990001111" }).success,
    ).toBe(false);
  });
});

describe("vanCreateSchema", () => {
  it("accepts a complete van", () => {
    expect(
      vanCreateSchema.safeParse({
        vanNumber: "VAN-014",
        plate: "ABC 1234",
        carType: "Hi Ace Super Grandia",
        site: "Manila",
      }).success,
    ).toBe(true);
  });

  it("requires a plate — it is the real identifier of a vehicle", () => {
    expect(
      vanCreateSchema.safeParse({
        vanNumber: "VAN-014",
        plate: "",
        carType: "Hi Ace",
        site: "Manila",
      }).success,
    ).toBe(false);
  });
});

describe("adminCreateSchema", () => {
  const valid = {
    fullName: "Juan Cruz",
    email: "juan.cruz@carelon.com",
    domainId: "AB12345",
    site: "all",
    notify: true,
    superAdmin: false,
  };

  it("accepts an admin site of all, which the fleet sites do not permit", () => {
    expect(adminCreateSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects a title-case site — admin sites are stored lower-case", () => {
    expect(
      adminCreateSchema.safeParse({ ...valid, site: "Iloilo" }).success,
    ).toBe(false);
  });

  it("accepts an email with no domain id", () => {
    expect(
      adminCreateSchema.safeParse({ ...valid, domainId: null }).success,
    ).toBe(true);
  });

  it("accepts a domain id with no email", () => {
    expect(adminCreateSchema.safeParse({ ...valid, email: null }).success).toBe(
      true,
    );
  });

  it("rejects a row with NEITHER, which the identity CHECK would reject anyway", () => {
    // Caught here so the user sees a message naming both fields, rather than a
    // constraint violation surfacing as a bare 500.
    const result = adminCreateSchema.safeParse({
      ...valid,
      email: null,
      domainId: null,
    });
    expect(result.success).toBe(false);
  });

  it("lower-cases the email, matching the unique index on lower(trim(email))", () => {
    expect(
      adminCreateSchema.parse({ ...valid, email: "Juan.Cruz@Carelon.com" })
        .email,
    ).toBe("juan.cruz@carelon.com");
  });

  it("leaves the domain id's case alone", () => {
    // admin_whitelist_domain_id_idx is a PLAIN unique index and matchWhitelist
    // compares verbatim, so folding here would break the match. See roles.ts.
    expect(
      adminCreateSchema.parse({ ...valid, domainId: "ab12345" }).domainId,
    ).toBe("ab12345");
  });
});

describe("adminPatchSchema", () => {
  it("rejects a blank email", () => {
    // `asKey` in roles.ts treats trimmed-empty as ABSENT, while the DB's
    // identity CHECK is satisfied by the Domain ID — so this would create an
    // active row that is permanently unmatchable at login.
    expect(adminPatchSchema.safeParse({ email: "" }).success).toBe(false);
  });

  it("rejects a blank domain id", () => {
    expect(adminPatchSchema.safeParse({ domainId: "  " }).success).toBe(false);
  });

  it("does not carry `active` — a patch must not flip it silently", () => {
    // `ADMIN_FIELDS` omits `active`, so a patch carrying it would change the
    // row while the `updated` event described only the other fields. Stripped
    // here, which leaves `{ active }` alone as an EMPTY patch.
    expect(adminPatchSchema.safeParse({ active: false }).success).toBe(false);
    expect(adminPatchSchema.parse({ notify: false })).not.toHaveProperty(
      "active",
    );
  });

  it("still rejects an empty patch", () => {
    // The original bug: `.partial()` preserves `.default()`, so `{}` parsed to
    // `{ shift: null }` and passed the emptiness check.
    expect(adminPatchSchema.safeParse({}).success).toBe(false);
  });

  it("rejects a body mixing activation with a field change", () => {
    expect(
      adminPatchSchema.safeParse({ active: false, notify: false }).success,
    ).toBe(false);
  });

  it("rejects an unknown key rather than silently ignoring it", () => {
    expect(
      adminPatchSchema.safeParse({ notify: false, notifyy: false }).success,
    ).toBe(false);
  });
});

describe("fieldForConstraint", () => {
  it.each([
    ["vans_van_number_key", "vanNumber"],
    ["vans_plate_key", "plate"],
    ["admin_whitelist_email_lower_trim_idx", "email"],
    ["admin_whitelist_domain_id_idx", "domainId"],
  ])("maps %s to the %s field", (constraint, field) => {
    expect(
      fieldForConstraint(
        `duplicate key value violates unique constraint "${constraint}"`,
      ),
    ).toBe(field);
  });

  it("returns null for a constraint it does not know", () => {
    // So an unmapped violation surfaces as a real error rather than being
    // silently attributed to the wrong input.
    expect(
      fieldForConstraint('violates unique constraint "something_else"'),
    ).toBe(null);
  });
});
