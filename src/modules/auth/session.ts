import { jwtVerify, SignJWT } from "jose";
import { z } from "zod";
import { APP_ROLES, type AppRole } from "@/modules/auth/roles";

export const SESSION_COOKIE = "vr_session";
export const SESSION_TTL_SECONDS = 8 * 60 * 60;

const ALGORITHM = "HS256";

const sessionSchema = z.object({
  userId: z.string().min(1),
  domainId: z.string().min(1),
  name: z.string().min(1),
  email: z.string().min(3),
  // Derived from the canonical list — never a hand-written second copy.
  role: z.enum(APP_ROLES),
  // Defaults false so a cookie signed before this field existed still parses
  // instead of bouncing every logged-in user to `null` on deploy. Safe only
  // because nothing authorizes on this value — see the docblock below.
  superAdmin: z.boolean().default(false),
});

export interface SessionUser {
  userId: string;
  domainId: string;
  name: string;
  email: string;
  role: AppRole;
  /**
   * COSMETIC ONLY — nothing authorizes on it, and nothing currently reads it.
   * A capability baked into a signed cookie lags the database in BOTH
   * directions: it survives a revocation and misses a grant until the holder
   * logs out. `/roster` and `/api/admins` therefore both re-read `super_admin`
   * (`isSuperAdmin`) so the tab and the writes behind it cannot disagree.
   */
  superAdmin: boolean;
}

const key = (secret: string) => new TextEncoder().encode(secret);

export async function createSessionToken(
  user: SessionUser,
  secret: string,
): Promise<string> {
  return new SignJWT({ ...user })
    .setProtectedHeader({ alg: ALGORITHM })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(key(secret));
}

/**
 * `token` accepts `undefined` because every real caller reads it from
 * `cookies().get(SESSION_COOKIE)?.value`. Taking it here means the missing-cookie
 * case is refused and tested in one place instead of each caller writing `?? ""`.
 */
export async function readSessionToken(
  token: string | undefined,
  secret: string,
): Promise<SessionUser | null> {
  if (token === undefined || token === "") return null;
  try {
    const { payload } = await jwtVerify(token, key(secret), {
      algorithms: [ALGORITHM],
      // `jose` enforces `exp` only when the claim is PRESENT. Without this,
      // dropping `.setExpirationTime` above would mint permanently-valid
      // role-bearing tokens and every test would still pass.
      requiredClaims: ["exp"],
    });
    const parsed = sessionSchema.safeParse(payload);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
