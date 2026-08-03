import { z } from "zod";
import { resolveDatabaseUrl, resolveTestDatabaseUrl } from "@/lib/db-url";

const schema = z
  .object({
    // Resolved before parsing — see `parseEnv`. Either supplied directly or
    // composed from DB_HOST / DB_NAME / DB_USER and friends.
    DATABASE_URL: z.string().min(1),
    TEST_DATABASE_URL: z.string().min(1).optional(),
    SESSION_SECRET: z.string().min(32),
    // No default: the stub provider takes identity from the request body, so an
    // omitted variable must not silently select it. Choosing the auth provider
    // is a required, affirmative act. `.env.example` sets this explicitly, so
    // no workflow changes.
    AUTH_MODE: z.enum(["stub", "cgsauth"]),
    // Base URL of the CGS Associate Authentication API. Defaults to production;
    // point at https://uat.teamcgs.io for pre-prod. Only consulted when
    // AUTH_MODE=cgsauth.
    CGS_AUTH_BASE_URL: z.string().url().default("https://teamcgs.io"),
    // The x-api-key issued to this application. Kept server-side and never sent
    // to the browser. Required when AUTH_MODE=cgsauth (enforced below).
    CGS_AUTH_API_KEY: z.string().min(1).optional(),
    APP_URL: z.string().min(1).default("http://localhost:3000"),
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    // Email transport. `stub` captures messages without sending (dev/test);
    // `ses` sends through Amazon SES. Unlike AUTH_MODE this DOES default — to
    // `stub` — because the stub refuses to construct in production, so a prod
    // deploy that forgets EMAIL_MODE=ses fails loudly at first use rather than
    // silently dropping mail. The AWS_* / EMAIL_FROM values below are required
    // only when EMAIL_MODE=ses (enforced in the superRefine).
    EMAIL_MODE: z.enum(["stub", "ses"]).default("stub"),
    // The AWS SDK's own names, so the same values work for any future AWS
    // client and for tooling that already expects them. Note the consequence:
    // an AWS_* pair exported by the shell is picked up by the SDK's default
    // credential chain even when EMAIL_MODE=stub.
    AWS_REGION: z.string().min(1).optional(),
    AWS_ACCESS_KEY_ID: z.string().min(1).optional(),
    AWS_SECRET_ACCESS_KEY: z.string().min(1).optional(),
    // Required for TEMPORARY credentials — SSO / assume-role keys, which start
    // `ASIA` rather than `AKIA`. Without it the pair above authenticates as
    // nobody and SES answers 403 on every send. Optional because a permanent
    // IAM user key has no session token, and passing an empty one is an error.
    //
    // Temporary credentials also EXPIRE, typically within hours, so this is a
    // local-development affordance. A deployment wants either a permanent key
    // or no explicit credentials at all — see the credential-chain note below.
    AWS_SESSION_TOKEN: z.string().min(1).optional(),
    // The verified SES sender identity, e.g. `Van Reservation <no-reply@…>`.
    EMAIL_FROM: z.string().min(1).optional(),
    // Optional Reply-To for outbound mail (e.g. an OPS Support inbox).
    EMAIL_REPLY_TO: z.string().min(1).optional(),
    // Addresses copied on EVERY outbound message — requestor mail included, not
    // just the admin notices. Comma-separated; parsed here into a trimmed,
    // blank-free array so no consumer has to split a string and no blank entry
    // can reach SES (which rejects the whole message for one).
    //
    // Applied in `sendEmail`, the single function every message passes through,
    // so a new template or a new enqueue site cannot forget it. Empty by
    // default: an unset variable copies nobody, which is what dev and test want.
    EMAIL_ALWAYS_CC: z
      .string()
      .default("")
      .transform((raw) =>
        raw
          .split(",")
          .map((address) => address.trim())
          .filter((address) => address !== ""),
      ),
    // Shared secret guarding the outbox sweeper (GET
    // /api/internal/dispatch-outbox). Optional, and its ABSENCE makes the
    // endpoint 404 rather than open — an endpoint that drains the mail queue
    // must never be reachable by default. 16 characters minimum so a
    // placeholder cannot pass for one.
    DISPATCH_SECRET: z.string().min(16).optional(),
  })
  .superRefine((val, ctx) => {
    // cgsauth without a key would fail every login as a 401 (indistinguishable
    // from a bad password), silently. Refuse to boot instead — the same
    // fail-closed posture as AUTH_MODE.
    if (val.AUTH_MODE === "cgsauth" && !val.CGS_AUTH_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["CGS_AUTH_API_KEY"],
        message: "CGS_AUTH_API_KEY is required when AUTH_MODE=cgsauth",
      });
    }
    // SES cannot send without a region and a verified From. Refuse to boot
    // rather than construct a transport that 500s on its first send.
    if (val.EMAIL_MODE === "ses") {
      for (const field of ["AWS_REGION", "EMAIL_FROM"] as const) {
        if (!val[field]) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [field],
            message: `${field} is required when EMAIL_MODE=ses`,
          });
        }
      }

      // Credentials are BOTH or NEITHER, and neither is a supported choice:
      // omitting them hands authentication to the AWS SDK's default credential
      // chain, which reads a named profile, an SSO session, or an instance /
      // task role — and refreshes each of those on its own. That is what a
      // deployment should use, and it spares a local SSO user re-pasting an
      // expiring key every few hours.
      //
      // Exactly one of the pair is always a mistake, and a silent one: the SDK
      // would fall through to the chain and authenticate as somebody other than
      // the key that was supplied, so this refuses rather than guesses.
      const id = val.AWS_ACCESS_KEY_ID;
      const secret = val.AWS_SECRET_ACCESS_KEY;
      if (Boolean(id) !== Boolean(secret)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [id ? "AWS_SECRET_ACCESS_KEY" : "AWS_ACCESS_KEY_ID"],
          message:
            "AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY must be set together, or both left empty to use the AWS default credential chain",
        });
      }

      // A session token belongs to a key pair. On its own it configures nothing
      // and signals that a paste went half-finished.
      if (val.AWS_SESSION_TOKEN && !id) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["AWS_SESSION_TOKEN"],
          message:
            "AWS_SESSION_TOKEN requires AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY",
        });
      }
    }
  });

export type Env = z.infer<typeof schema>;

export function parseEnv(raw: NodeJS.ProcessEnv = process.env): Env {
  const result = schema.safeParse({
    ...raw,
    DATABASE_URL: resolveDatabaseUrl(raw),
    TEST_DATABASE_URL: resolveTestDatabaseUrl(raw),
  });
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("\n  ");
    throw new Error(`Invalid environment:\n  ${issues}`);
  }
  return result.data;
}

let cached: Env | null = null;

export function env(): Env {
  if (cached === null) cached = parseEnv();
  return cached;
}
