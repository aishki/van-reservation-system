import { describe, expect, it } from "vitest";
import {
  auditQueryFrom,
  auditQuerySchema,
  encodeCursor,
} from "@/modules/audit/wire";

const parse = (search: string) =>
  auditQuerySchema.safeParse(auditQueryFrom(new URLSearchParams(search)));

describe("auditQuerySchema", () => {
  it("reads a bare query as the newest page of everything", () => {
    const result = parse("");
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual({
      source: "reservations",
      action: null,
      actor: null,
      from: null,
      to: null,
      limit: 50,
      cursor: null,
    });
  });

  it("reads every filter", () => {
    const result = parse(
      "action=approved&actor=ivy&from=2026-08-01&to=2026-08-31&limit=10",
    );
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toMatchObject({
      action: "approved",
      actor: "ivy",
      from: "2026-08-01",
      to: "2026-08-31",
      limit: 10,
    });
  });

  // A cap a caller can raise is not a cap.
  it("refuses a limit above the maximum", () => {
    expect(parse("limit=10000").success).toBe(false);
  });

  it("refuses an action the log does not record", () => {
    expect(parse("action=submitted").success).toBe(false);
  });

  it("refuses a date that is not a plain calendar date", () => {
    expect(parse("from=2026-08-01T00:00:00Z").success).toBe(false);
  });

  it("round-trips a cursor", () => {
    const cursor = {
      at: "2026-08-05T01:00:00.000Z",
      id: "0f8fad5b-d9cb-469f-a165-70867728950e",
    };
    const result = parse(`cursor=${encodeCursor(cursor)}`);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.cursor).toEqual(cursor);
  });

  it("refuses a malformed cursor rather than matching nothing", () => {
    expect(parse("cursor=garbage").success).toBe(false);
  });

  it("reads the roster source with its own eventType filter", () => {
    const result = parse("source=roster&eventType=deactivated&actor=ivy");
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toMatchObject({
      source: "roster",
      eventType: "deactivated",
      actor: "ivy",
    });
  });

  it("defaults to the reservations source when absent", () => {
    const result = parse("");
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.source).toBe("reservations");
  });

  it("refuses an event type the roster log does not record", () => {
    expect(parse("source=roster&eventType=submitted").success).toBe(false);
  });

  it("ignores the reservations-only action filter on the roster source", () => {
    const result = parse("source=roster&action=approved");
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).not.toHaveProperty("action");
  });
});
