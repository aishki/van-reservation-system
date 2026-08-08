import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  formatReferenceNo,
  nextReferenceNo,
} from "@/modules/reservations/reference-no";
import { testDb } from "../../../test/with-rollback";

const db = testDb();

afterAll(async () => {
  await db.deleteFrom("reference_counters").execute();
  await db.destroy();
});

beforeEach(async () => {
  await db.deleteFrom("reference_counters").execute();
});

describe("formatReferenceNo", () => {
  it("zero-pads to six digits", () => {
    expect(formatReferenceNo(2026, 412)).toBe("VR-2026-000412");
    expect(formatReferenceNo(2026, 1)).toBe("VR-2026-000001");
  });
});

describe("nextReferenceNo", () => {
  it("starts each year at 000001 and increments", async () => {
    expect(await nextReferenceNo(db, 2026)).toBe("VR-2026-000001");
    expect(await nextReferenceNo(db, 2026)).toBe("VR-2026-000002");
  });

  it("keeps separate sequences per year", async () => {
    await nextReferenceNo(db, 2025);
    await nextReferenceNo(db, 2025);
    expect(await nextReferenceNo(db, 2026)).toBe("VR-2026-000001");
    expect(await nextReferenceNo(db, 2025)).toBe("VR-2025-000003");
  });

  it("never issues duplicates under concurrency", async () => {
    const issued = await Promise.all(
      Array.from({ length: 25 }, () => nextReferenceNo(db, 2026)),
    );
    expect(new Set(issued).size).toBe(25);
  });
});
