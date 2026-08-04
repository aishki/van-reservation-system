import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("users")
    .addColumn("id", "uuid", (c) =>
      c.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn("domain_id", "text", (c) => c.notNull().unique())
    .addColumn("name", "text", (c) => c.notNull())
    .addColumn("email", "text", (c) => c.notNull())
    .addColumn("mobile_number", "text")
    .addColumn("role", "text", (c) => c.notNull())
    .addColumn("last_login_at", "timestamptz")
    .addColumn("created_at", "timestamptz", (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .addColumn("updated_at", "timestamptz", (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .addCheckConstraint(
      "users_role_check",
      sql`role in ('associate', 'admin_support')`,
    )
    .execute();

  await db.schema
    .createIndex("users_email_idx")
    .on("users")
    .column("email")
    .execute();

  await db.schema
    .createTable("admin_whitelist")
    .addColumn("id", "uuid", (c) =>
      c.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn("full_name", "text", (c) => c.notNull())
    .addColumn("email", "text")
    .addColumn("domain_id", "text")
    .addColumn("site", "text", (c) => c.notNull())
    .addColumn("notify", "boolean", (c) => c.notNull().defaultTo(true))
    .addColumn("active", "boolean", (c) => c.notNull().defaultTo(true))
    .addColumn("created_at", "timestamptz", (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .addCheckConstraint(
      "admin_whitelist_site_check",
      sql`site in ('iloilo', 'manila', 'all')`,
    )
    .addCheckConstraint(
      "admin_whitelist_identity_check",
      sql`email is not null or domain_id is not null`,
    )
    .execute();

  await sql`
    create unique index admin_whitelist_email_lower_idx
      on admin_whitelist (lower(email)) where email is not null
  `.execute(db);

  await sql`
    create unique index admin_whitelist_domain_id_idx
      on admin_whitelist (domain_id) where domain_id is not null
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("admin_whitelist").execute();
  await db.schema.dropTable("users").execute();
}
