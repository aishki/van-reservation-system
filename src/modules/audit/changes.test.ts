import { describe, expect, it } from "vitest";
import { parseChanges } from "@/modules/audit/changes";
import { AUDIT_ACTIONS } from "@/modules/audit/types";
import { RESERVATION_EVENT_TYPES } from "@/modules/reservations/db-map";

describe("parseChanges", () => {
  it("reads the current shape", () => {
    expect(
      parseChanges({
        fields: [{ field: "purpose", label: "Purpose", from: "A", to: "B" }],
      }),
    ).toEqual({
      kind: "fields",
      changes: [{ field: "purpose", label: "Purpose", from: "A", to: "B" }],
    });
  });

  // Rows written before this branch hold names only. They CANNOT be
  // backfilled — the values were never captured — so the reader says so rather
  // than pretending to a diff it does not have.
  it("reads the legacy names-only shape", () => {
    expect(parseChanges({ fields: ["purpose", "startAt"] })).toEqual({
      kind: "names",
      fields: ["purpose", "startAt"],
    });
  });

  it.each([
    null,
    undefined,
    {},
    { fields: null },
    { fields: 3 },
    "nonsense",
    [],
  ])("returns none for %o rather than throwing", (raw) => {
    expect(parseChanges(raw)).toEqual({ kind: "none" });
  });

  it("drops a malformed entry rather than the whole row", () => {
    expect(
      parseChanges({
        fields: [
          { field: "purpose", label: "Purpose", from: "A", to: "B" },
          { nonsense: true },
        ],
      }),
    ).toEqual({
      kind: "fields",
      changes: [{ field: "purpose", label: "Purpose", from: "A", to: "B" }],
    });
  });

  it("treats an empty fields array as nothing recorded", () => {
    expect(parseChanges({ fields: [] })).toEqual({ kind: "none" });
  });

  // A null `from` is the legitimate record of a first assignment, not a
  // malformed entry.
  it("keeps a null side", () => {
    expect(
      parseChanges({
        fields: [{ field: "driver", label: "Driver", from: null, to: "Rey" }],
      }),
    ).toEqual({
      kind: "fields",
      changes: [{ field: "driver", label: "Driver", from: null, to: "Rey" }],
    });
  });
});

// A typo here silently filters the whole log to nothing, and an empty audit
// page looks exactly like a quiet week.
describe("AUDIT_ACTIONS", () => {
  it("names only event types the database admits", () => {
    for (const action of AUDIT_ACTIONS) {
      expect(RESERVATION_EVENT_TYPES).toContain(action);
    }
  });

  it("excludes submitted, which is the requestor's act", () => {
    expect([...AUDIT_ACTIONS]).not.toContain("submitted");
  });
});
