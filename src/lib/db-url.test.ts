import { describe, expect, it } from "vitest";
import {
  resolveDatabaseUrl,
  resolveTestDatabaseUrl,
  schemaFromUrl,
} from "@/lib/db-url";

const parts = {
  DB_HOST: "db.example.internal",
  DB_PORT: "5432",
  DB_NAME: "AutomationsDB",
  DB_USER: "am65108",
  DB_PASSWORD: "p@ss word",
};

describe("resolveDatabaseUrl", () => {
  it("returns DATABASE_URL verbatim when set", () => {
    expect(
      resolveDatabaseUrl({ ...parts, DATABASE_URL: "postgres://a@b:1/c" }),
    ).toBe("postgres://a@b:1/c");
  });

  it("composes from DB_* when DATABASE_URL is absent", () => {
    expect(resolveDatabaseUrl(parts)).toBe(
      "postgres://am65108:p%40ss%20word@db.example.internal:5432/AutomationsDB",
    );
  });

  // A password is routinely rejected by the URL parser otherwise — `@` ends the
  // credentials, so an unescaped one silently moves the host.
  it("percent-encodes credentials", () => {
    const url = resolveDatabaseUrl({ ...parts, DB_PASSWORD: "a:b@c/d?e" });
    expect(url).toContain("am65108:a%3Ab%40c%2Fd%3Fe@db.example.internal");
    expect(new URL(url as string).hostname).toBe("db.example.internal");
  });

  it("omits the password section when there is no password", () => {
    expect(resolveDatabaseUrl({ ...parts, DB_PASSWORD: undefined })).toBe(
      "postgres://am65108@db.example.internal:5432/AutomationsDB",
    );
  });

  it("defaults the port to 5432", () => {
    expect(resolveDatabaseUrl({ ...parts, DB_PORT: undefined })).toContain(
      ":5432/",
    );
  });

  it("carries DB_SCHEMA as a search_path startup option", () => {
    expect(resolveDatabaseUrl({ ...parts, DB_SCHEMA: "vanreserve" })).toContain(
      "options=-c+search_path%3Dvanreserve",
    );
  });

  it("carries DB_SSLMODE", () => {
    expect(resolveDatabaseUrl({ ...parts, DB_SSLMODE: "no-verify" })).toContain(
      "sslmode=no-verify",
    );
  });

  it("returns undefined when the DB_* set is incomplete", () => {
    expect(
      resolveDatabaseUrl({ ...parts, DB_HOST: undefined }),
    ).toBeUndefined();
    expect(resolveDatabaseUrl({})).toBeUndefined();
  });
});

describe("resolveTestDatabaseUrl", () => {
  it("returns TEST_DATABASE_URL verbatim when set", () => {
    expect(
      resolveTestDatabaseUrl({ ...parts, TEST_DATABASE_URL: "postgres://t" }),
    ).toBe("postgres://t");
  });

  // Without DB_SCHEMA the environment is a local instance where creating a
  // database is allowed, and a separate database is the stronger isolation.
  it("derives a sibling DATABASE when no schema is configured", () => {
    expect(resolveTestDatabaseUrl(parts)).toBe(
      "postgres://am65108:p%40ss%20word@db.example.internal:5432/AutomationsDB_test",
    );
  });

  // With DB_SCHEMA the environment is a shared server where CREATE DATABASE is
  // typically refused, so isolation has to come from a sibling schema instead.
  it("derives a sibling SCHEMA in the same database when one is configured", () => {
    const url = resolveTestDatabaseUrl({ ...parts, DB_SCHEMA: "vanreserve" });
    expect(url).toContain("/AutomationsDB?");
    expect(url).toContain("options=-c+search_path%3Dvanreserve_test");
  });

  // The global setup refuses a test URL equal to the dev one; both derived
  // shapes must therefore differ from what resolveDatabaseUrl returns.
  it("never matches the development url", () => {
    for (const schema of [undefined, "vanreserve"]) {
      const env = { ...parts, DB_SCHEMA: schema };
      expect(resolveTestDatabaseUrl(env)).not.toBe(resolveDatabaseUrl(env));
    }
  });

  it("returns undefined when the DB_* set is incomplete", () => {
    expect(resolveTestDatabaseUrl({})).toBeUndefined();
  });
});

describe("schemaFromUrl", () => {
  it("reads the schema a search_path option pins", () => {
    expect(
      schemaFromUrl(
        "postgres://u@h:5432/d?options=-c%20search_path%3Dvanreserve",
      ),
    ).toBe("vanreserve");
  });

  // Only the first entry is created: that is where unqualified CREATE lands.
  it("returns only the first entry of a multi-schema path", () => {
    expect(
      schemaFromUrl(
        "postgres://u@h:5432/d?options=-c%20search_path%3Dvanreserve,public",
      ),
    ).toBe("vanreserve");
  });

  it("returns null when no schema is pinned", () => {
    expect(schemaFromUrl("postgres://u@h:5432/d")).toBeNull();
    expect(schemaFromUrl("postgres://u@h:5432/d?sslmode=require")).toBeNull();
  });

  it("returns null rather than throwing on an unparseable url", () => {
    expect(schemaFromUrl("not a url")).toBeNull();
  });
});
