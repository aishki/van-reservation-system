import { type Kysely, sql } from "kysely";
import { env } from "@/lib/env";
import type { DB } from "@/modules/db/types";
import { sendEmail } from "@/modules/email/service";
import { renderTemplate } from "@/modules/email/templates";
import type {
  EmailError,
  EmailFailure,
  MailTransport,
} from "@/modules/email/transport";

/**
 * Delivers queued notifications.
 *
 * No scheduling logic of its own: callers decide when (an `after()` on the write
 * routes, and a swept endpoint for anything enqueued while the provider was
 * down). Idempotent by construction — the claim query below IS the lock, so
 * calling this twice at once cannot double-send.
 */

/** Retried. Anything else is permanent and must not be tried again. */
const TRANSIENT: ReadonlySet<EmailFailure> = new Set<EmailFailure>([
  "SERVICE_UNAVAILABLE",
  "RATE_LIMITED",
]);

const MAX_ATTEMPTS = 8;

/** Doubling, capped at an hour. */
function backoffMinutes(attempts: number): number {
  return Math.min(2 ** attempts, 60);
}

/**
 * What goes into `last_error`: the code, plus whatever the provider said.
 *
 * The code alone is what this column used to hold, and it was not enough to act
 * on — `SERVICE_UNAVAILABLE` reads as "SES is down" whether SES is down or the
 * access key is wrong. The detail is the difference between those.
 */
function reasonOf(error: EmailError): string {
  return error.detail === undefined
    ? error.code
    : `${error.code}: ${error.detail}`;
}

export interface DispatchResult {
  sent: number;
  failed: number;
  retrying: number;
}

interface ClaimedRow {
  id: string;
  template: string;
  recipient: string;
  cc: unknown;
  payload: unknown;
  attempts: number;
}

/**
 * `alwaysCc` is resolved here, once per sweep, and handed to every `sendEmail`
 * below rather than left to that function's own environment default.
 *
 * Two reasons. It reads the environment once instead of once per claimed row;
 * and it makes this function's output a function of its arguments, so the
 * integration tests can pin the standing copy instead of inheriting whatever
 * the developer's `.env` happens to say — `test/global-setup.int.ts` loads
 * `dotenv/config`, so without this a real `EMAIL_ALWAYS_CC` would turn a
 * cc assertion here red for a reason that has nothing to do with dispatching.
 */
export async function dispatchOutbox(
  db: Kysely<DB>,
  transport: MailTransport,
  limit = 25,
  alwaysCc: readonly string[] = env().EMAIL_ALWAYS_CC,
): Promise<DispatchResult> {
  // Claim BEFORE sending, so two dispatchers cannot send the same mail twice.
  //
  // The safety property is the ATOMICITY of this single statement plus its
  // `status = 'pending'` predicate: a concurrent claim re-evaluates that
  // predicate against the committed row and so can never take a row already
  // moved to 'sending'. Splitting this into a SELECT and then an UPDATE would
  // break that — `skip locked` would not save it.
  //
  // `skip locked` is a LIVENESS clause, not the safety one. Without it a second
  // dispatcher blocks until the first commits, then re-checks the predicate and
  // claims nothing — correct, but serialized, which matters because `after()`
  // fires on every write and routinely overlaps the sweeper.
  //
  // `attempts` is incremented at CLAIM time, not after the send, so a row left
  // in 'sending' by a killed process still converges on MAX_ATTEMPTS rather
  // than being retried forever.
  const claimed = await sql<ClaimedRow>`
    update notification_outbox set status = 'sending', attempts = attempts + 1
    where id in (
      select id from notification_outbox
      where status = 'pending' and next_attempt_at <= now()
      order by created_at
      for update skip locked
      limit ${limit}
    )
    returning id, template, recipient, cc, payload, attempts
  `.execute(db);

  const result: DispatchResult = { sent: 0, failed: 0, retrying: 0 };

  for (const row of claimed.rows) {
    const rendered = await renderTemplate(row.template, row.payload);

    if (!rendered.ok) {
      // UNKNOWN_TEMPLATE / INVALID_PAYLOAD are programming errors. Retrying
      // replays the bug, so the row fails now and records which one it was.
      await fail(db, row.id, rendered.error);
      result.failed += 1;
      continue;
    }

    // The admin notices are queued with a comma-joined recipient list; SES takes
    // an array.
    const to = row.recipient
      .split(",")
      .map((address) => address.trim())
      .filter((address) => address !== "");
    const cc = Array.isArray(row.cc) ? (row.cc as string[]) : [];

    let outcome: Awaited<ReturnType<typeof sendEmail>>;
    try {
      outcome = await sendEmail(
        transport,
        { to, cc, ...rendered.value },
        alwaysCc,
      );
    } catch (error) {
      // An unknown throw is assumed transient — discarding a notification over a
      // bug in error handling is the worse failure — but it is CAPPED, exactly as
      // the typed-failure path below is. This branch used to call `retry`
      // unconditionally, so a send that kept throwing (rather than returning an
      // EmailError) cycled forever and the row never converged on `failed`.
      const reason = String(error);
      if (row.attempts < MAX_ATTEMPTS) {
        await retry(db, row.id, row.attempts, reason);
        result.retrying += 1;
      } else {
        await fail(db, row.id, reason);
        result.failed += 1;
      }
      continue;
    }

    if (outcome.ok) {
      await db
        .updateTable("notification_outbox")
        .set({
          status: "sent",
          sent_at: new Date(),
          provider_message_id: outcome.value.id,
          last_error: null,
        })
        .where("id", "=", row.id)
        .execute();
      result.sent += 1;
      continue;
    }

    // Retryable is a property of the FAILURE CODE; the cap is a property of the
    // row. A permanently unreachable provider must not leave rows cycling
    // forever. `detail` never enters this decision — it is for the operator.
    const reason = reasonOf(outcome.error);
    if (TRANSIENT.has(outcome.error.code) && row.attempts < MAX_ATTEMPTS) {
      await retry(db, row.id, row.attempts, reason);
      result.retrying += 1;
      continue;
    }

    await fail(db, row.id, reason);
    result.failed += 1;
  }

  return result;
}

async function retry(
  db: Kysely<DB>,
  id: string,
  attempts: number,
  reason: string,
): Promise<void> {
  await db
    .updateTable("notification_outbox")
    .set({
      status: "pending",
      last_error: reason,
      next_attempt_at: new Date(Date.now() + backoffMinutes(attempts) * 60_000),
    })
    .where("id", "=", id)
    .execute();
}

async function fail(db: Kysely<DB>, id: string, reason: string): Promise<void> {
  await db
    .updateTable("notification_outbox")
    .set({ status: "failed", last_error: reason })
    .where("id", "=", id)
    .execute();

  // The ONLY signal that someone was never told, so it carries what is needed to
  // act. `operations.md` documents the queries that find these afterwards.
  console.error(`[email:dispatch] permanent failure id=${id} reason=${reason}`);
}
