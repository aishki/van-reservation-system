import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create unique index users_domain_id_lower_idx on users (lower(domain_id))
  `.execute(db);

  // lower(email) alone let " x@y.com" and "x@y.com" coexist; matchWhitelist
  // already folds both, so the index must agree with the app's key.
  await sql`drop index admin_whitelist_email_lower_idx`.execute(db);
  await sql`
    create unique index admin_whitelist_email_lower_trim_idx
      on admin_whitelist (lower(trim(email))) where email is not null
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`drop index admin_whitelist_email_lower_trim_idx`.execute(db);
  await sql`
    create unique index admin_whitelist_email_lower_idx
      on admin_whitelist (lower(email)) where email is not null
  `.execute(db);
  await sql`drop index users_domain_id_lower_idx`.execute(db);
}
