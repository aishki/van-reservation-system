import { afterEach, describe, expect, it, vi } from "vitest";
import { GET as INDEX } from "../route";
import { GET } from "./route";

const params = (template: string) => ({
  params: Promise.resolve({ template }),
});
const request = (
  url = "http://localhost:3000/api/dev/email/booking-submitted",
) => new Request(url);

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /api/dev/email/[template]", () => {
  it("renders the template as HTML", async () => {
    const response = await GET(request(), params("booking-submitted"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    const body = await response.text();
    expect(body).toContain("VR-1042");
    expect(body).toContain("VR-1044");
  });

  it("states who the mail is addressed to, and who is copied", async () => {
    const approved = await GET(request(), params("status-approved"));
    const body = await approved.text();
    expect(body).toContain("To");
    expect(body).toContain("arielle.jimera@carelon.com");
    expect(body).toContain("Cc");
    // The Iloilo admins, cc'd on the approval notice.
    expect(body).toContain("ivy.balandra@carelon.com");
  });

  it("carries the addressing into the plain-text view too", async () => {
    const response = await GET(
      request(
        "http://localhost:3000/api/dev/email/status-approved?format=text",
      ),
      params("status-approved"),
    );
    const body = await response.text();
    expect(body).toContain("To: arielle.jimera@carelon.com");
    expect(body).toContain("Cc: ");
    expect(body).toContain("Subject: Van reservation VR-1042 — Approved");
  });

  it("returns the plain-text alternative when asked", async () => {
    const response = await GET(
      request(
        "http://localhost:3000/api/dev/email/booking-submitted?format=text",
      ),
      params("booking-submitted"),
    );
    expect(response.headers.get("content-type")).toContain("text/plain");
    const body = await response.text();
    expect(body).toContain("VR-1042");
    expect(body).not.toContain("<html");
  });

  it("404s an unknown template rather than throwing", async () => {
    const response = await GET(request(), params("no-such-template"));
    expect(response.status).toBe(404);
  });

  it("404s in production, so the preview never ships", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const response = await GET(request(), params("booking-submitted"));
    expect(response.status).toBe(404);
  });
});

describe("GET /api/dev/email", () => {
  it("lists every preview", async () => {
    const response = await INDEX();
    expect(response.status).toBe(200);
    const body = await response.text();
    for (const name of [
      "booking-submitted",
      "booking-submitted-single",
      "booking-submitted-standby",
      "admin-new-request",
      "status-approved",
      "status-rejected",
      "status-cancelled-by-requestor",
      "status-cancelled-by-admin",
      "driver-assigned",
      "driver-changed",
    ]) {
      expect(body).toContain(name);
    }
  });

  it("404s in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    expect((await INDEX()).status).toBe(404);
  });
});
