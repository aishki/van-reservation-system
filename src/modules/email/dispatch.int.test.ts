import { sql } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import { err, ok, type Result } from "@/lib/result";
import { dispatchOutbox } from "@/modules/email/dispatch";
import {
  type EmailError,
  type EmailMessage,
  emailError,
  type MailTransport,
  type SentMessage,
} from "@/modules/email/transport";
import { testDb } from "../../../test/with-rollback";

const db = testDb();

/** Marks this suite's rows so cleanup cannot touch another's. */
const MARK = "dispatch-int@x.invalid";

/** Every event this suite creates carries it, so cleanup finds them all. */
const LINK = "/manage?ref=VR-9100";

/** `dispatchOutbox`'s own default, restated so the argument after it can be given. */
const LIMIT = 25;

/**
 * Passed to every call below.
 *
 * `test/global-setup.int.ts` imports `dotenv/config`, so a real
 * `EMAIL_ALWAYS_CC` in the developer's `.env` would otherwise be appended to
 * every message this suite sends and turn the cc assertions red for a reason
 * that has nothing to do with dispatching. The standing copy gets its own case
 * at the end instead.
 */
const NO_STANDING_CC: readonly string[] = [];

interface FakeTransport extends MailTransport {
  calls: EmailMessage[];
}

function transportReturning(
  result: Result<SentMessage, EmailError>,
): FakeTransport {
  const calls: EmailMessage[] = [];
  return {
    calls,
    async send(message) {
      calls.push(message);
      return result;
    },
  };
}

function throwingTransport(): FakeTransport {
  const calls: EmailMessage[] = [];
  return {
    calls,
    async send(message) {
      calls.push(message);
      throw new Error("socket hang up");
    },
  };
}

const payload = {
  status: "Approved",
  site: "Iloilo",
  rideMode: "Pickup / Drop-Off",
  requestor: {
    name: "Juan Cruz",
    email: "juan@x.invalid",
    mobile: "09171234567",
  },
  manageUrl: "http://localhost:3000/manage",
  trips: [
    {
      mode: "pickup",
      referenceId: "VR-9100",
      purpose: "Client visit",
      details: "Quarterly review with the account team.",
      pickup: "Aug 10 2026 · 7:30 AM",
      pickupPoint: "Smallville",
      dropoffPoint: "CGS Office",
      passengers: [{ name: "Juan Cruz", domainId: "AB12345" }],
    },
  ],
};

async function queue(
  template = "booking-status-change",
  body: unknown = payload,
  cc: string[] = [],
): Promise<string> {
  const event = await db
    .insertInto("notification_events")
    .values({
      event: "approved",
      title: "Van reservation approved",
      body: "VR-9100 is approved.",
      link: LINK,
    })
    .returning("id")
    .executeTakeFirstOrThrow();

  const row = await db
    .insertInto("notification_outbox")
    .values({
      event_id: event.id,
      template,
      recipient: MARK,
      cc: JSON.stringify(cc),
      payload: JSON.stringify(body),
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}

const rowById = (id: string) =>
  db
    .selectFrom("notification_outbox")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirstOrThrow();

// These rows COMMIT, so cleanup is mandatory: a leak breaks a LATER suite while
// this one still passes. Deleting by the EVENT and letting ON DELETE CASCADE
// take the outbox rows — matching on `recipient` missed the row whose recipient
// is a comma-joined list, which is exactly the near-miss that leaks.
afterEach(async () => {
  await sql`delete from notification_events where link = ${LINK}`.execute(db);
});

describe("dispatchOutbox", () => {
  it("sends a pending row and marks it sent with the provider id", async () => {
    const id = await queue();
    const transport = transportReturning(ok({ id: "ses-42" }));

    expect(await dispatchOutbox(db, transport, LIMIT, NO_STANDING_CC)).toEqual({
      sent: 1,
      failed: 0,
      retrying: 0,
    });

    const row = await rowById(id);
    expect(row.status).toBe("sent");
    expect(row.provider_message_id).toBe("ses-42");
    expect(row.sent_at).not.toBeNull();
    // Incremented at CLAIM time, so a row orphaned in 'sending' still converges.
    expect(row.attempts).toBe(1);
  });

  it("applies the standing cc to a queued message", async () => {
    await queue();

    const transport = transportReturning(ok({ id: "ses-1" }));
    await dispatchOutbox(db, transport, LIMIT, ["standing@x.invalid"]);

    expect(transport.calls[0].cc).toEqual(["standing@x.invalid"]);
  });

  it("splits a comma-joined recipient list and passes the cc through", async () => {
    await db
      .insertInto("notification_outbox")
      .values({
        event_id: (
          await db
            .insertInto("notification_events")
            .values({
              event: "submitted",
              title: "t",
              body: "b",
              link: LINK,
            })
            .returning("id")
            .executeTakeFirstOrThrow()
        ).id,
        template: "booking-status-change",
        recipient: `${MARK}, second-${MARK}`,
        cc: JSON.stringify(["cc-one@x.invalid", "cc-two@x.invalid"]),
        payload: JSON.stringify(payload),
      })
      .execute();

    const transport = transportReturning(ok({ id: "ses-1" }));
    await dispatchOutbox(db, transport, LIMIT, NO_STANDING_CC);

    expect(transport.calls[0].to).toEqual([MARK, `second-${MARK}`]);
    expect(transport.calls[0].cc).toEqual([
      "cc-one@x.invalid",
      "cc-two@x.invalid",
    ]);
  });

  it("does not re-send an already sent row", async () => {
    await queue();
    await dispatchOutbox(
      db,
      transportReturning(ok({ id: "ses-1" })),
      LIMIT,
      NO_STANDING_CC,
    );

    const second = transportReturning(ok({ id: "ses-2" }));
    expect(await dispatchOutbox(db, second, LIMIT, NO_STANDING_CC)).toEqual({
      sent: 0,
      failed: 0,
      retrying: 0,
    });
    expect(second.calls).toHaveLength(0);
  });

  it("fails a rejected message permanently", async () => {
    const id = await queue();
    expect(
      await dispatchOutbox(
        db,
        transportReturning(err(emailError("EMAIL_REJECTED"))),
        LIMIT,
        NO_STANDING_CC,
      ),
    ).toEqual({ sent: 0, failed: 1, retrying: 0 });

    const row = await rowById(id);
    expect(row.status).toBe("failed");
    expect(row.last_error).toContain("EMAIL_REJECTED");
  });

  /**
   * The column an operator actually reads. A bare code cannot be acted on:
   * `SERVICE_UNAVAILABLE` reads as "SES is down" whether SES is down or the
   * access key is wrong — a real outage on this project, diagnosed only after
   * hours because the SDK's own `InvalidClientTokenId` was discarded here.
   */
  it("records the provider's own error alongside the code", async () => {
    const id = await queue();
    await dispatchOutbox(
      db,
      transportReturning(
        err(
          emailError(
            "EMAIL_REJECTED",
            "UnrecognizedClientException — The security token included is invalid — HTTP 403",
          ),
        ),
      ),
      LIMIT,
      NO_STANDING_CC,
    );

    const row = await rowById(id);
    expect(row.last_error).toContain("EMAIL_REJECTED");
    expect(row.last_error).toContain("UnrecognizedClientException");
    expect(row.last_error).toContain("HTTP 403");
  });

  it("retries a transient failure later, not now", async () => {
    const id = await queue();
    expect(
      await dispatchOutbox(
        db,
        transportReturning(err(emailError("SERVICE_UNAVAILABLE"))),
        LIMIT,
        NO_STANDING_CC,
      ),
    ).toEqual({ sent: 0, failed: 0, retrying: 1 });

    const row = await rowById(id);
    expect(row.status).toBe("pending");
    expect(row.attempts).toBe(1);
    // Backed off, so a second pass in the same minute picks nothing up.
    expect(row.next_attempt_at.getTime()).toBeGreaterThan(Date.now());

    const second = transportReturning(ok({ id: "ses-2" }));
    await dispatchOutbox(db, second, LIMIT, NO_STANDING_CC);
    expect(second.calls).toHaveLength(0);
  });

  it("treats a thrown error as transient", async () => {
    const id = await queue();
    const transport = throwingTransport();
    expect(await dispatchOutbox(db, transport, LIMIT, NO_STANDING_CC)).toEqual({
      sent: 0,
      failed: 0,
      retrying: 1,
    });

    const row = await rowById(id);
    expect(row.status).toBe("pending");
    expect(row.last_error).toContain("socket hang up");
  });

  it("gives up on a transient failure once attempts are exhausted", async () => {
    const id = await queue();
    await db
      .updateTable("notification_outbox")
      .set({ attempts: 7 })
      .where("id", "=", id)
      .execute();

    expect(
      await dispatchOutbox(
        db,
        transportReturning(err(emailError("RATE_LIMITED"))),
        LIMIT,
        NO_STANDING_CC,
      ),
    ).toEqual({ sent: 0, failed: 1, retrying: 0 });
    expect((await rowById(id)).status).toBe("failed");
  });

  it("fails an unknown template without calling the transport", async () => {
    await queue("booking-teleported");
    const transport = transportReturning(ok({ id: "ses-1" }));
    expect(await dispatchOutbox(db, transport, LIMIT, NO_STANDING_CC)).toEqual({
      sent: 0,
      failed: 1,
      retrying: 0,
    });
    expect(transport.calls).toHaveLength(0);
  });

  it("fails a malformed payload without calling the transport", async () => {
    await queue("booking-status-change", { site: "Iloilo" });
    const transport = transportReturning(ok({ id: "ses-1" }));
    expect(await dispatchOutbox(db, transport, LIMIT, NO_STANDING_CC)).toEqual({
      sent: 0,
      failed: 1,
      retrying: 0,
    });
    expect(transport.calls).toHaveLength(0);
  });

  it("honours the limit, leaving the rest pending", async () => {
    await queue();
    await queue();
    await queue();

    const transport = transportReturning(ok({ id: "ses-1" }));
    expect(await dispatchOutbox(db, transport, 2, NO_STANDING_CC)).toEqual({
      sent: 2,
      failed: 0,
      retrying: 0,
    });

    const stillPending = await db
      .selectFrom("notification_outbox")
      .select("id")
      .where("recipient", "=", MARK)
      .where("status", "=", "pending")
      .execute();
    expect(stillPending).toHaveLength(1);
  });

  it("gives up on a thrown error once attempts are exhausted", async () => {
    const id = await queue();
    // 7, so the claim's own increment takes it to MAX_ATTEMPTS.
    await db
      .updateTable("notification_outbox")
      .set({ attempts: 7 })
      .where("id", "=", id)
      .execute();

    const transport = throwingTransport();
    expect(await dispatchOutbox(db, transport, LIMIT, NO_STANDING_CC)).toEqual({
      sent: 0,
      failed: 1,
      retrying: 0,
    });

    // The cap applies to a THROW, not only to a typed EmailError. Without this
    // the row returned to `pending` and cycled forever.
    const row = await rowById(id);
    expect(row.status).toBe("failed");
    expect(row.attempts).toBe(8);
    expect(row.last_error).toContain("socket hang up");
  });

  // Guards the no-double-send property of the claim query under real
  // concurrency. Note what this does NOT pin: removing `skip locked` keeps this
  // test green, because the safety comes from the atomic UPDATE and its
  // `status = 'pending'` predicate, not from that clause. What would break it is
  // splitting the claim into a SELECT and a separate UPDATE.
  it("never hands the same row to two concurrent dispatchers", async () => {
    const ids = [await queue(), await queue(), await queue(), await queue()];

    const a = transportReturning(ok({ id: "ses-a" }));
    const b = transportReturning(ok({ id: "ses-b" }));
    const [first, second] = await Promise.all([
      dispatchOutbox(db, a, LIMIT, NO_STANDING_CC),
      dispatchOutbox(db, b, LIMIT, NO_STANDING_CC),
    ]);

    // Every row sent exactly once, however the four split between the two.
    expect(first.sent + second.sent).toBe(ids.length);
    expect(a.calls.length + b.calls.length).toBe(ids.length);
    expect(first.failed + second.failed).toBe(0);
    expect(first.retrying + second.retrying).toBe(0);

    const rows = await db
      .selectFrom("notification_outbox")
      .select(["id", "status", "attempts"])
      .where("recipient", "=", MARK)
      .execute();
    expect(rows).toHaveLength(ids.length);
    for (const row of rows) {
      expect(row.status).toBe("sent");
      // Claimed once, so incremented once. A double claim shows up here.
      expect(row.attempts).toBe(1);
    }
  });
});
