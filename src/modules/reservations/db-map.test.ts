import { describe, expect, it } from "vitest";
import {
  DB_RESERVATION_STATUSES,
  SITE_TO_DB,
  STATUS_TO_DB,
  siteFromDb,
  statusFromDb,
} from "@/modules/reservations/db-map";
import {
  RESERVATION_STATUSES,
  SITE_LOCATIONS,
} from "@/modules/reservations/types";

describe("reservation status mapping", () => {
  it("round-trips every wire status", () => {
    for (const status of RESERVATION_STATUSES) {
      expect(statusFromDb(STATUS_TO_DB[status])).toBe(status);
    }
  });

  it("covers exactly the wire vocabulary", () => {
    expect(new Set(DB_RESERVATION_STATUSES).size).toBe(
      RESERVATION_STATUSES.length,
    );
  });

  it("throws on an unknown db value", () => {
    expect(() => statusFromDb("assigned")).toThrow(
      /unknown reservation status/i,
    );
  });
});

describe("site mapping", () => {
  it("round-trips every site", () => {
    for (const site of SITE_LOCATIONS) {
      expect(siteFromDb(SITE_TO_DB[site])).toBe(site);
    }
  });

  it("throws on an unknown db value", () => {
    expect(() => siteFromDb("cebu")).toThrow(/unknown site/i);
  });
});
