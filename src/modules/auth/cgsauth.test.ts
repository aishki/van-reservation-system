import { describe, expect, it, vi } from "vitest";
import { err, ok } from "@/lib/result";
import { CgsAuthProvider } from "@/modules/auth/cgsauth";

const BASE = "https://cgs.test";
const KEY = "test-api-key";

const request = (body: unknown) =>
  new Request("http://localhost:3000/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

function jsonResponse(status: number, body: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

type Scripted = Response | (() => Response | Promise<Response>);

interface RecordedCall {
  url: string;
  method: string;
  apiKey: string | null;
  body: string | null;
}

function scriptedFetch(script: {
  login?: Scripted;
  associate?: Scripted;
  verifyDomain?: Scripted;
}) {
  const calls: RecordedCall[] = [];
  const impl = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    calls.push({
      url,
      method: init?.method ?? "GET",
      apiKey: headers.get("x-api-key"),
      body: typeof init?.body === "string" ? init.body : null,
    });
    const pick = url.includes("/api/verifyDomain")
      ? script.verifyDomain
      : url.includes("/api/login")
        ? script.login
        : url.includes("/api/associate")
          ? script.associate
          : undefined;
    if (pick === undefined) throw new Error(`unexpected fetch to ${url}`);
    return typeof pick === "function" ? pick() : pick;
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

const provider = (fetchImpl: typeof fetch, timeoutMs?: number) =>
  new CgsAuthProvider({ baseUrl: BASE, apiKey: KEY, fetchImpl, timeoutMs });

// A factory, not a shared instance: a Response body streams once, so reusing a
// single Response across tests would leave later reads on an already-consumed
// body. Each call yields a fresh 200.
const validLogin = () =>
  jsonResponse(200, {
    associate: {
      domainId: "al12345",
      firstName: "Jane",
      lastName: "Doe",
      location: "Manila",
    },
  });

describe("CgsAuthProvider — success", () => {
  it("verifies the password then enriches the identity from the full record", async () => {
    const { impl, calls } = scriptedFetch({
      login: validLogin,
      associate: jsonResponse(200, {
        domainId: "AL12345",
        firstName: "Jane",
        lastName: "Doe",
        email: "jane.doe@company.com",
        personalNumber: "09171234567",
      }),
    });

    const result = await provider(impl).identify(
      request({ domainId: "AL12345", password: "s3cr3t!" }),
    );

    expect(result).toEqual({
      ok: true,
      value: {
        domainId: "AL12345",
        name: "Jane Doe",
        email: "jane.doe@company.com",
        contactNumber: "09171234567",
      },
    });

    // Both calls are server-to-server with the api key; login sends the
    // credentials, the lookup keys on the echoed domain id.
    expect(calls.every((c) => c.apiKey === KEY)).toBe(true);
    const login = calls.find((c) => c.url.includes("/api/login"));
    expect(login?.method).toBe("POST");
    expect(JSON.parse(login?.body ?? "null")).toEqual({
      domainId: "AL12345",
      password: "s3cr3t!",
    });
    const lookup = calls.find((c) => c.url.includes("/api/associate"));
    expect(lookup?.method).toBe("GET");
    expect(lookup?.url).toContain("domainId=al12345");
  });

  it("canonicalizes the domain id to upper-case regardless of input casing", async () => {
    const { impl, calls } = scriptedFetch({
      login: validLogin,
      associate: jsonResponse(200, {
        // No domainId echoed here — the login echo is the fallback source.
        firstName: "Jane",
        lastName: "Doe",
        email: "jane.doe@company.com",
      }),
    });

    const result = await provider(impl).identify(
      request({ domainId: " al12345 ", password: "s3cr3t!" }),
    );

    expect(result.ok && result.value.domainId).toBe("AL12345");
    // The upstream directory rejects a lower-case id, so canonicalizing only
    // the returned identity would still fail every login typed in lower case.
    const login = calls.find((c) => c.url.includes("/api/login"));
    expect(JSON.parse(login?.body ?? "null")).toEqual({
      domainId: "AL12345",
      password: "s3cr3t!",
    });
  });

  it("omits contactNumber when the record has no personal number", async () => {
    const { impl } = scriptedFetch({
      login: validLogin,
      associate: jsonResponse(200, {
        domainId: "AL12345",
        firstName: "Jane",
        lastName: "Doe",
        email: "jane.doe@company.com",
      }),
    });

    const result = await provider(impl).identify(
      request({ domainId: "AL12345", password: "s3cr3t!" }),
    );

    expect(result).toEqual({
      ok: true,
      value: {
        domainId: "AL12345",
        name: "Jane Doe",
        email: "jane.doe@company.com",
      },
    });
  });

  it("tolerates a trailing slash on the base url", async () => {
    const { impl, calls } = scriptedFetch({
      login: validLogin,
      associate: jsonResponse(200, {
        domainId: "AL12345",
        firstName: "Jane",
        lastName: "Doe",
        email: "jane.doe@company.com",
      }),
    });

    await new CgsAuthProvider({
      baseUrl: `${BASE}/`,
      apiKey: KEY,
      fetchImpl: impl,
    }).identify(request({ domainId: "AL12345", password: "s3cr3t!" }));

    expect(calls[0]?.url).toBe(`${BASE}/api/login`);
  });
});

describe("CgsAuthProvider — it never registers or enumerates", () => {
  it("only ever calls POST /api/login and GET /api/associate", async () => {
    const { impl, calls } = scriptedFetch({
      login: validLogin,
      associate: jsonResponse(200, {
        domainId: "AL12345",
        firstName: "Jane",
        lastName: "Doe",
        email: "jane.doe@company.com",
      }),
    });

    await provider(impl).identify(
      request({ domainId: "AL12345", password: "s3cr3t!" }),
    );

    // No anonymous enumeration oracle, and no credential registration — the
    // register transaction is also POST /api/associate, so assert the method.
    expect(calls.some((c) => c.url.includes("/api/verifyDomain"))).toBe(false);
    expect(
      calls.every(
        (c) => !c.url.includes("/api/associate") || c.method === "GET",
      ),
    ).toBe(true);
    expect(calls.map((c) => c.url.replace(BASE, ""))).toEqual([
      "/api/login",
      "/api/associate?domainId=al12345",
    ]);
  });
});

describe("CgsAuthProvider — credential failures", () => {
  it("refuses a rejected credential with NOT_AUTHENTICATED and does not enrich", async () => {
    const { impl, calls } = scriptedFetch({
      login: jsonResponse(401, { error: "Invalid credentials" }),
    });

    const result = await provider(impl).identify(
      request({ domainId: "AL12345", password: "wrong" }),
    );

    expect(result).toEqual({ ok: false, error: "NOT_AUTHENTICATED" });
    // A failed password must not trigger the follow-up lookup.
    expect(calls.some((c) => c.url.includes("/api/associate"))).toBe(false);
  });

  it("refuses a malformed request body without any upstream call", async () => {
    const { impl, calls } = scriptedFetch({});
    const result = await provider(impl).identify(request("not json"));
    expect(result).toEqual({ ok: false, error: "NOT_AUTHENTICATED" });
    expect(calls).toHaveLength(0);
  });

  it.each([
    { domainId: "", password: "x" },
    { domainId: "AL12345", password: "" },
  ])(
    "refuses a blank field (%o) without spending an upstream attempt",
    async (body) => {
      const { impl, calls } = scriptedFetch({});
      const result = await provider(impl).identify(request(body));
      expect(result).toEqual({ ok: false, error: "NOT_AUTHENTICATED" });
      expect(calls).toHaveLength(0);
    },
  );
});

describe("CgsAuthProvider — outages and rate limits are distinct", () => {
  it("maps a login rate limit to RATE_LIMITED", async () => {
    const { impl } = scriptedFetch({
      login: jsonResponse(429, {
        error: "Too many requests, try again shortly",
      }),
    });
    const result = await provider(impl).identify(
      request({ domainId: "AL12345", password: "s3cr3t!" }),
    );
    expect(result).toEqual({ ok: false, error: "RATE_LIMITED" });
  });

  it("maps a login 5xx to SERVICE_UNAVAILABLE", async () => {
    const { impl } = scriptedFetch({
      login: jsonResponse(500, { error: "boom" }),
    });
    const result = await provider(impl).identify(
      request({ domainId: "AL12345", password: "s3cr3t!" }),
    );
    expect(result).toEqual({ ok: false, error: "SERVICE_UNAVAILABLE" });
  });

  it("maps a network error to SERVICE_UNAVAILABLE", async () => {
    const { impl } = scriptedFetch({
      login: () => {
        throw new Error("ECONNREFUSED");
      },
    });
    const result = await provider(impl).identify(
      request({ domainId: "AL12345", password: "s3cr3t!" }),
    );
    expect(result).toEqual({ ok: false, error: "SERVICE_UNAVAILABLE" });
  });

  it("maps a timeout (aborted request) to SERVICE_UNAVAILABLE", async () => {
    const hanging = ((_url: unknown, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      })) as unknown as typeof fetch;

    const result = await provider(hanging, 10).identify(
      request({ domainId: "AL12345", password: "s3cr3t!" }),
    );
    expect(result).toEqual({ ok: false, error: "SERVICE_UNAVAILABLE" });
  });
});

describe("CgsAuthProvider — enrichment failures after a verified password", () => {
  it("treats a missing associate record as SERVICE_UNAVAILABLE, not a bad credential", async () => {
    const { impl } = scriptedFetch({
      login: validLogin,
      associate: jsonResponse(200, null),
    });
    const result = await provider(impl).identify(
      request({ domainId: "AL12345", password: "s3cr3t!" }),
    );
    expect(result).toEqual({ ok: false, error: "SERVICE_UNAVAILABLE" });
  });

  it("treats a record with no corporate email as SERVICE_UNAVAILABLE", async () => {
    const { impl } = scriptedFetch({
      login: validLogin,
      associate: jsonResponse(200, {
        domainId: "AL12345",
        firstName: "Jane",
        lastName: "Doe",
      }),
    });
    const result = await provider(impl).identify(
      request({ domainId: "AL12345", password: "s3cr3t!" }),
    );
    expect(result).toEqual({ ok: false, error: "SERVICE_UNAVAILABLE" });
  });

  it("maps a lookup rate limit to RATE_LIMITED", async () => {
    const { impl } = scriptedFetch({
      login: validLogin,
      associate: jsonResponse(429, {
        error: "Too many requests, try again shortly",
      }),
    });
    const result = await provider(impl).identify(
      request({ domainId: "AL12345", password: "s3cr3t!" }),
    );
    expect(result).toEqual({ ok: false, error: "RATE_LIMITED" });
  });

  it("maps a rejected api key on lookup (401) to SERVICE_UNAVAILABLE", async () => {
    const { impl } = scriptedFetch({
      login: validLogin,
      associate: jsonResponse(401, { error: "Unauthorized" }),
    });
    const result = await provider(impl).identify(
      request({ domainId: "AL12345", password: "s3cr3t!" }),
    );
    expect(result).toEqual({ ok: false, error: "SERVICE_UNAVAILABLE" });
  });
});

describe("CgsAuthProvider — verifyDomain", () => {
  it("reports exists:true (200) and POSTs the id with the api key", async () => {
    const { impl, calls } = scriptedFetch({
      verifyDomain: jsonResponse(200, {
        exists: true,
        registered: true,
        domainId: "AL12345",
        associate: { domainId: "AL12345", firstName: "Jane", lastName: "Doe" },
      }),
    });

    const result = await provider(impl).verifyDomain("AL12345");

    expect(result).toEqual({ ok: true, value: { exists: true } });
    const call = calls.find((c) => c.url.includes("/api/verifyDomain"));
    expect(call?.method).toBe("POST");
    expect(call?.apiKey).toBe(KEY);
    expect(JSON.parse(call?.body ?? "null")).toEqual({ domainId: "AL12345" });
    // The pre-check must not leak anything but the boolean, and must not touch
    // login or the full-record lookup.
    expect(calls.some((c) => c.url.includes("/api/login"))).toBe(false);
    expect(calls.some((c) => c.url.includes("/api/associate"))).toBe(false);
  });

  it("upper-cases the id it POSTs", async () => {
    const { impl, calls } = scriptedFetch({
      verifyDomain: jsonResponse(200, { exists: true }),
    });

    await provider(impl).verifyDomain(" al12345 ");

    expect(JSON.parse(calls[0]?.body ?? "null")).toEqual({
      domainId: "AL12345",
    });
  });

  it("reports exists:false for a 400 (no active associate)", async () => {
    const { impl } = scriptedFetch({
      verifyDomain: jsonResponse(400, { error: "Invalid Domain ID" }),
    });
    expect(await provider(impl).verifyDomain("ZZ00000")).toEqual({
      ok: true,
      value: { exists: false },
    });
  });

  it("returns exists:false for a blank id without calling the API", async () => {
    const { impl, calls } = scriptedFetch({});
    expect(await provider(impl).verifyDomain("   ")).toEqual({
      ok: true,
      value: { exists: false },
    });
    expect(calls).toHaveLength(0);
  });

  it("maps a rate limit to RATE_LIMITED", async () => {
    const { impl } = scriptedFetch({
      verifyDomain: jsonResponse(429, { error: "Too many requests" }),
    });
    expect(await provider(impl).verifyDomain("AL12345")).toEqual({
      ok: false,
      error: "RATE_LIMITED",
    });
  });

  it.each([
    ["a 500", jsonResponse(500, { error: "boom" })],
    [
      "a network error",
      () => {
        throw new Error("ECONNREFUSED");
      },
    ],
  ] as const)("maps %s to SERVICE_UNAVAILABLE", async (_label, response) => {
    const { impl } = scriptedFetch({ verifyDomain: response });
    expect(await provider(impl).verifyDomain("AL12345")).toEqual({
      ok: false,
      error: "SERVICE_UNAVAILABLE",
    });
  });
});

describe("lookupName", () => {
  it("maps a 200 doc to a trimmed display name and sends the api key", async () => {
    const { impl, calls } = scriptedFetch({
      associate: jsonResponse(200, {
        domainId: "ab12345",
        firstName: " Juan ",
        lastName: "Dela Cruz",
      }),
    });
    const provider = new CgsAuthProvider({
      baseUrl: BASE,
      apiKey: KEY,
      fetchImpl: impl,
    });
    const result = await provider.lookupName("AB12345");
    expect(result).toEqual(ok({ name: "Juan Dela Cruz" }));
    expect(calls[0].url).toBe(`${BASE}/api/associate?domainId=AB12345`);
    expect(calls[0].apiKey).toBe(KEY);
  });

  it("upper-cases the id in the query string", async () => {
    const { impl, calls } = scriptedFetch({
      associate: jsonResponse(200, { firstName: "Juan", lastName: "Cruz" }),
    });

    await provider(impl).lookupName(" ab12345 ");

    expect(calls[0].url).toBe(`${BASE}/api/associate?domainId=AB12345`);
  });

  it("treats 400 and 404 as no match, not an outage", async () => {
    for (const status of [400, 404]) {
      const { impl } = scriptedFetch({
        associate: jsonResponse(status, undefined),
      });
      const provider = new CgsAuthProvider({
        baseUrl: BASE,
        apiKey: KEY,
        fetchImpl: impl,
      });
      expect(await provider.lookupName("AB12345")).toEqual(ok(null));
    }
  });

  it("treats a 200 with a null body as no match", async () => {
    const { impl } = scriptedFetch({
      associate: jsonResponse(200, undefined),
    });
    const provider = new CgsAuthProvider({
      baseUrl: BASE,
      apiKey: KEY,
      fetchImpl: impl,
    });
    expect(await provider.lookupName("AB12345")).toEqual(ok(null));
  });

  it("returns null when the matched doc has no usable name parts", async () => {
    const { impl } = scriptedFetch({
      associate: jsonResponse(200, { domainId: "ab12345" }),
    });
    const provider = new CgsAuthProvider({
      baseUrl: BASE,
      apiKey: KEY,
      fetchImpl: impl,
    });
    expect(await provider.lookupName("AB12345")).toEqual(ok(null));
  });

  it("maps 429 to RATE_LIMITED and 500 to SERVICE_UNAVAILABLE", async () => {
    const rateLimited = scriptedFetch({
      associate: jsonResponse(429, undefined),
    });
    const limitedProvider = new CgsAuthProvider({
      baseUrl: BASE,
      apiKey: KEY,
      fetchImpl: rateLimited.impl,
    });
    expect(await limitedProvider.lookupName("AB12345")).toEqual(
      err("RATE_LIMITED"),
    );

    const broken = scriptedFetch({ associate: jsonResponse(500, undefined) });
    const brokenProvider = new CgsAuthProvider({
      baseUrl: BASE,
      apiKey: KEY,
      fetchImpl: broken.impl,
    });
    expect(await brokenProvider.lookupName("AB12345")).toEqual(
      err("SERVICE_UNAVAILABLE"),
    );
  });

  it("returns null for a blank Domain ID without calling the API", async () => {
    const { impl, calls } = scriptedFetch({});
    const provider = new CgsAuthProvider({
      baseUrl: BASE,
      apiKey: KEY,
      fetchImpl: impl,
    });
    expect(await provider.lookupName("   ")).toEqual(ok(null));
    expect(calls).toHaveLength(0);
  });
});
