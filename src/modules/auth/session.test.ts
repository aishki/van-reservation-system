import { describe, expect, it } from "vitest";
import {
  createSessionToken,
  readSessionToken,
  type SessionUser,
} from "@/modules/auth/session";

const SECRET = "0123456789012345678901234567890123";
const OTHER = "abcdefghijabcdefghijabcdefghijabcd";

const user: SessionUser = {
  userId: "6f1c1b3e-0000-4000-8000-000000000001",
  domainId: "AB12345",
  name: "Juan Dela Cruz",
  email: "juan.delacruz@carelon.com",
  role: "associate",
  superAdmin: false,
};

describe("session tokens", () => {
  it("round-trips a session user", async () => {
    const token = await createSessionToken(user, SECRET);
    await expect(readSessionToken(token, SECRET)).resolves.toEqual(user);
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await createSessionToken(user, OTHER);
    await expect(readSessionToken(token, SECRET)).resolves.toBeNull();
  });

  // The real attack, not just a malformed string: re-encode the payload with an
  // escalated role and reattach the original signature.
  it("rejects a payload substituted to escalate the role", async () => {
    const token = await createSessionToken(user, SECRET);
    const [header, payload, signature] = token.split(".");
    const claims = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    );
    const escalated = Buffer.from(
      JSON.stringify({ ...claims, role: "admin_support" }),
      "utf8",
    ).toString("base64url");
    const forged = `${header}.${escalated}.${signature}`;
    await expect(readSessionToken(forged, SECRET)).resolves.toBeNull();
  });

  it("rejects garbage", async () => {
    await expect(readSessionToken("not-a-token", SECRET)).resolves.toBeNull();
  });

  it("rejects an empty token", async () => {
    await expect(readSessionToken("", SECRET)).resolves.toBeNull();
  });

  it("rejects a missing token", async () => {
    await expect(readSessionToken(undefined, SECRET)).resolves.toBeNull();
  });

  it("preserves the admin_support role", async () => {
    const admin = { ...user, role: "admin_support" as const };
    const token = await createSessionToken(admin, SECRET);
    const read = await readSessionToken(token, SECRET);
    expect(read?.role).toBe("admin_support");
  });

  it("rejects a validly signed token whose payload is the wrong shape", async () => {
    const { SignJWT } = await import("jose");
    const token = await new SignJWT({ userId: "only-this" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode(SECRET));
    await expect(readSessionToken(token, SECRET)).resolves.toBeNull();
  });

  // These three pin the guards that `createSessionToken` and `jwtVerify` supply.
  // Without them, deleting `.setExpirationTime`, dropping `requiredClaims`, or
  // dropping `algorithms` all leave the suite green.
  it("rejects an expired token", async () => {
    const { SignJWT } = await import("jose");
    const token = await new SignJWT({ ...user })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("-1s")
      .sign(new TextEncoder().encode(SECRET));
    await expect(readSessionToken(token, SECRET)).resolves.toBeNull();
  });

  it("rejects a token with no expiry claim at all", async () => {
    const { SignJWT } = await import("jose");
    const token = await new SignJWT({ ...user })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .sign(new TextEncoder().encode(SECRET));
    await expect(readSessionToken(token, SECRET)).resolves.toBeNull();
  });

  // Signed with the correct secret, so this is not an attack — it fails the
  // moment the `algorithms` allowlist is removed, which is the point.
  it("rejects a correctly signed token using a non-allowlisted algorithm", async () => {
    const { SignJWT } = await import("jose");
    const token = await new SignJWT({ ...user })
      .setProtectedHeader({ alg: "HS384" })
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode(SECRET));
    await expect(readSessionToken(token, SECRET)).resolves.toBeNull();
  });

  // Pins the `.default(false)` on `superAdmin` in sessionSchema: a token signed
  // before that field existed must still parse, not bounce the user to `null`.
  it("defaults superAdmin to false for a payload predating the field", async () => {
    const { SignJWT } = await import("jose");
    const { superAdmin: _superAdmin, ...legacy } = user;
    const token = await new SignJWT({ ...legacy })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode(SECRET));
    const read = await readSessionToken(token, SECRET);
    expect(read?.superAdmin).toBe(false);
  });
});
