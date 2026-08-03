/**
 * Builds Postgres connection strings from discrete `DB_*` variables, for
 * environments that hand out a host/user/password set rather than a URL.
 *
 * Deliberately dependency-free: `.config/kysely.config.ts` imports this through
 * jiti, outside the app's build and its `@/` alias resolution.
 *
 * `DATABASE_URL` always wins when set. That precedence is the conventional one,
 * but it has a sharp edge worth knowing: a `DATABASE_URL` exported by your shell
 * or OS silently outranks a `DB_*` set written in `.env`, because dotenv never
 * overrides an existing variable. If composition seems to be ignored, that is
 * why — check `echo "$DATABASE_URL"` first.
 */

export interface DbEnv {
  DATABASE_URL?: string | undefined;
  TEST_DATABASE_URL?: string | undefined;
  DB_HOST?: string | undefined;
  DB_PORT?: string | undefined;
  DB_NAME?: string | undefined;
  DB_USER?: string | undefined;
  DB_PASSWORD?: string | undefined;
  /** Target schema. Omit to use the server's default (`public`). */
  DB_SCHEMA?: string | undefined;
  /** Passed through verbatim, e.g. `no-verify` for a private corporate CA. */
  DB_SSLMODE?: string | undefined;
  /** Present so a whole `process.env` is assignable — every field above is
   * optional, which would otherwise make this a weak type. */
  [key: string]: string | undefined;
}

const DEFAULT_PORT = "5432";

/**
 * `search_path` travels as a libpq startup option rather than a URL path
 * segment, so every unqualified `CREATE TABLE` and query in the app resolves
 * inside the named schema without a single call site having to qualify itself.
 */
function connectionString(
  parts: DbEnv,
  database: string,
  schema: string | undefined,
): string {
  const user = encodeURIComponent(parts.DB_USER ?? "");
  const auth =
    parts.DB_PASSWORD === undefined || parts.DB_PASSWORD === ""
      ? user
      : `${user}:${encodeURIComponent(parts.DB_PASSWORD)}`;
  const host = parts.DB_HOST ?? "";
  const port = parts.DB_PORT ?? DEFAULT_PORT;

  const query = new URLSearchParams();
  if (parts.DB_SSLMODE) query.set("sslmode", parts.DB_SSLMODE);
  if (schema) query.set("options", `-c search_path=${schema}`);
  const suffix = query.size === 0 ? "" : `?${query}`;

  return `postgres://${auth}@${host}:${port}/${encodeURIComponent(database)}${suffix}`;
}

/** True when enough `DB_*` values are present to build a connection string. */
function composable(parts: DbEnv): boolean {
  return Boolean(parts.DB_HOST && parts.DB_NAME && parts.DB_USER);
}

/** `DATABASE_URL`, or one composed from `DB_*`, or undefined. */
export function resolveDatabaseUrl(parts: DbEnv): string | undefined {
  if (parts.DATABASE_URL) return parts.DATABASE_URL;
  if (!composable(parts)) return undefined;
  return connectionString(parts, parts.DB_NAME as string, parts.DB_SCHEMA);
}

/**
 * `TEST_DATABASE_URL`, or one derived from `DB_*`.
 *
 * The derived form follows how the environment is shaped. With `DB_SCHEMA` set
 * the tests get a sibling SCHEMA in the same database — the only option on a
 * shared server where you cannot create databases. Without it they get a
 * sibling DATABASE, which is the stronger isolation and what a local instance
 * should use.
 */
export function resolveTestDatabaseUrl(parts: DbEnv): string | undefined {
  if (parts.TEST_DATABASE_URL) return parts.TEST_DATABASE_URL;
  if (!composable(parts)) return undefined;
  return parts.DB_SCHEMA
    ? connectionString(
        parts,
        parts.DB_NAME as string,
        `${parts.DB_SCHEMA}_test`,
      )
    : connectionString(parts, `${parts.DB_NAME}_test`, undefined);
}

/**
 * The schema a connection string pins through `options=-c search_path=…`, or
 * null when it names none. Only the first entry is returned: that is where
 * unqualified `CREATE` statements land, and so the one that must exist.
 */
export function schemaFromUrl(url: string): string | null {
  let options: string | null;
  try {
    options = new URL(url).searchParams.get("options");
  } catch {
    return null;
  }
  if (options === null) return null;

  const match = /(?:^|\s)-c\s*search_path\s*=\s*([^\s]+)/.exec(options);
  const first = match?.[1]?.split(",")[0]?.trim();
  return first === undefined || first === "" ? null : first;
}
