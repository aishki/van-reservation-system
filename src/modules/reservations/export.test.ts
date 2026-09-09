import { describe, expect, it } from "vitest";
import { ALL } from "@/modules/reservations/admin-filters";
import { reportFileName } from "@/modules/reservations/export";

describe("reportFileName", () => {
  it.each([
    [
      { site: "Manila", mode: "pickup", month: "2026-08" },
      "van-trips_manila_pickup_2026-08.xlsx",
    ],
    [
      { site: ALL, mode: ALL, month: ALL },
      "van-trips_all-sites_all-types_all-time.xlsx",
    ],
    [
      { site: "Iloilo", mode: "standby", month: ALL },
      "van-trips_iloilo_standby_all-time.xlsx",
    ],
  ] as const)("names %o as %s", (scope, expected) => {
    expect(reportFileName(scope)).toBe(expected);
  });

  // The design builds this from its display labels, one of which is
  // "Pickup/Drop Off" — a slash, which no platform allows in a filename.
  it("never contains a character a filesystem refuses", () => {
    const name = reportFileName({
      site: "Manila",
      mode: "pickup",
      month: "2026-08",
    });
    expect(name).toMatch(/^[a-z0-9_.-]+$/);
  });
});
