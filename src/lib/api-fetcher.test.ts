import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiFetch } from "@/lib/api-fetcher";

const mockFetch = (body: unknown, status: number) => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify(body), {
          status,
          headers: { "content-type": "application/json" },
        }),
    ),
  );
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("apiFetch", () => {
  it("returns the parsed body on success", async () => {
    mockFetch({ user: { role: "associate" } }, 200);
    await expect(apiFetch("/api/auth/session")).resolves.toEqual({
      user: { role: "associate" },
    });
  });

  it("throws ApiError carrying the code and message", async () => {
    mockFetch(
      { error: { code: "FORBIDDEN", message: "Admin Support only." } },
      403,
    );
    await expect(apiFetch("/api/auth/login")).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "Admin Support only.",
      status: 403,
    });
  });

  it("exposes validation details", async () => {
    mockFetch(
      {
        error: {
          code: "VALIDATION_FAILED",
          message: "Invalid",
          details: { domainId: "Required" },
        },
      },
      422,
    );
    await expect(apiFetch("/api/auth/login")).rejects.toMatchObject({
      details: { domainId: "Required" },
    });
  });

  it("throws a usable ApiError when the body is not our envelope", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html>502</html>", { status: 502 })),
    );
    const error = (await apiFetch("/api/auth/session").catch(
      (e) => e,
    )) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(502);
  });
});
