import { describe, expect, it } from "vitest";
import {
  isTower,
  isTripPurpose,
  TOWERS,
  TRIP_PURPOSES,
} from "@/modules/reservations/reference";

describe("TRIP_PURPOSES", () => {
  it("offers eighteen purposes with Others last", () => {
    expect(TRIP_PURPOSES).toHaveLength(18);
    expect(TRIP_PURPOSES.at(-1)).toBe("Others");
  });
});

describe("isTripPurpose", () => {
  it("accepts every listed purpose", () => {
    for (const purpose of TRIP_PURPOSES) {
      expect(isTripPurpose(purpose)).toBe(true);
    }
  });

  it("rejects a purpose that is not on the list", () => {
    expect(isTripPurpose("Weekend Beach Trip")).toBe(false);
    expect(isTripPurpose("Asset Retrieval")).toBe(true);
  });

  it("rejects non-string values", () => {
    expect(isTripPurpose(undefined)).toBe(false);
    expect(isTripPurpose(null)).toBe(false);
    expect(isTripPurpose(42)).toBe(false);
  });
});

describe("TOWERS", () => {
  it("offers five towers", () => {
    expect(TOWERS).toHaveLength(5);
  });
});

describe("isTower", () => {
  it("accepts every listed tower", () => {
    for (const tower of TOWERS) {
      expect(isTower(tower)).toBe(true);
    }
  });

  it("rejects a tower that is not on the list", () => {
    expect(isTower("Made-Up Tower")).toBe(false);
    expect(isTower("Ops Support")).toBe(true);
  });

  it("rejects non-string values", () => {
    expect(isTower(undefined)).toBe(false);
    expect(isTower(null)).toBe(false);
    expect(isTower(42)).toBe(false);
  });
});
