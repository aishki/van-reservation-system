import { describe, expect, it } from "vitest";
import { ERROR_STATUS, errorResponse } from "@/lib/api-error";

describe("errorResponse", () => {
  it("maps each error code to its documented status", () => {
    expect(ERROR_STATUS.VALIDATION_FAILED).toBe(422);
    expect(ERROR_STATUS.NOT_AUTHENTICATED).toBe(401);
    expect(ERROR_STATUS.FORBIDDEN).toBe(403);
    expect(ERROR_STATUS.NOT_FOUND).toBe(404);
    expect(ERROR_STATUS.INVALID_TRANSITION).toBe(409);
    expect(ERROR_STATUS.DRIVER_REQUIRED).toBe(422);
    expect(ERROR_STATUS.VERSION_CONFLICT).toBe(409);
    expect(ERROR_STATUS.SERVICE_UNAVAILABLE).toBe(503);
    expect(ERROR_STATUS.RATE_LIMITED).toBe(429);
    expect(ERROR_STATUS.EMAIL_REJECTED).toBe(422);
  });

  it("wraps the code and message in the single envelope", async () => {
    const response = errorResponse("NOT_FOUND", "Reservation not found");
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: { code: "NOT_FOUND", message: "Reservation not found" },
    });
  });

  it("includes details only when provided", async () => {
    const withDetails = errorResponse("VALIDATION_FAILED", "Invalid", {
      purpose: "Required",
    });
    await expect(withDetails.json()).resolves.toEqual({
      error: {
        code: "VALIDATION_FAILED",
        message: "Invalid",
        details: { purpose: "Required" },
      },
    });

    const without = errorResponse("FORBIDDEN", "Nope");
    const body = (await without.json()) as { error: Record<string, unknown> };
    expect("details" in body.error).toBe(false);
  });
});
