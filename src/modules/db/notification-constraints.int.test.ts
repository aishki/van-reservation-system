import type { Insertable, Transaction } from "kysely";
import { afterAll, describe, expect, it } from "vitest";
import type { DB } from "@/modules/db/types";
import { testDb, withRollback } from "../../../test/with-rollback";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const event = {
  event: "approved",
  title: "Van reservation approved",
  body: "VR-1042 is approved.",
  link: "/manage?ref=VR-1042",
};

async function seedEvent(trx: Transaction<DB>): Promise<string> {
  const row = await trx
    .insertInto("notification_events")
    .values(event)
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}

const message = (eventId: string) => ({
  event_id: eventId,
  template: "booking-status-change",
  recipient: "juan@example.invalid",
  payload: JSON.stringify({ ok: true }),
});

describe("notification_events constraints", () => {
  it("accepts an unread event with no reservation and no recipient", async () => {
    await withRollback(db, async (trx) => {
      const created = await trx
        .insertInto("notification_events")
        .values(event)
        .returning(["read_at", "created_at"])
        .executeTakeFirstOrThrow();
      expect(created.read_at).toBeNull();
      expect(created.created_at).not.toBeNull();
    });
  });

  it("rejects an event outside the known six", async () => {
    await withRollback(db, async (trx) => {
      await expect(
        trx
          .insertInto("notification_events")
          .values({ ...event, event: "teleported" })
          .execute(),
      ).rejects.toThrow(/notification_events_event_check/);
    });
  });

  it("admits every one of the six", async () => {
    await withRollback(db, async (trx) => {
      for (const name of [
        "submitted",
        "approved",
        "rejected",
        "cancelled",
        "driver_assigned",
        "driver_changed",
      ]) {
        await trx
          .insertInto("notification_events")
          .values({ ...event, event: name })
          .execute();
      }
      const rows = await trx
        .selectFrom("notification_events")
        .selectAll()
        .execute();
      expect(rows).toHaveLength(6);
    });
  });
});

describe("notification_outbox constraints", () => {
  it("accepts a pending row attached to an event", async () => {
    await withRollback(db, async (trx) => {
      const created = await trx
        .insertInto("notification_outbox")
        .values(message(await seedEvent(trx)))
        .returning(["status", "attempts", "cc"])
        .executeTakeFirstOrThrow();
      expect(created.status).toBe("pending");
      expect(created.attempts).toBe(0);
      expect(created.cc).toEqual([]);
    });
  });

  it("refuses an orphan row, so a message cannot exist without its cause", async () => {
    await withRollback(db, async (trx) => {
      // Deliberately missing `event_id`, to prove the database refuses it. Cast
      // through Insertable rather than `any`: the point is that the SHAPE is
      // incomplete, and this keeps every other column type-checked.
      const orphan = {
        template: "booking-status-change",
        recipient: "juan@example.invalid",
        payload: JSON.stringify({}),
      } as Insertable<DB["notification_outbox"]>;

      await expect(
        trx.insertInto("notification_outbox").values(orphan).execute(),
      ).rejects.toThrow();
    });
  });

  it("rejects an unknown status", async () => {
    await withRollback(db, async (trx) => {
      await expect(
        trx
          .insertInto("notification_outbox")
          .values({ ...message(await seedEvent(trx)), status: "queued" })
          .execute(),
      ).rejects.toThrow(/notification_outbox_status_check/);
    });
  });

  it("rejects a sent row with no provider id", async () => {
    await withRollback(db, async (trx) => {
      await expect(
        trx
          .insertInto("notification_outbox")
          .values({
            ...message(await seedEvent(trx)),
            status: "sent",
            sent_at: new Date(),
          })
          .execute(),
      ).rejects.toThrow(/notification_outbox_sent_check/);
    });
  });

  it("rejects an unsent row that claims a provider id", async () => {
    await withRollback(db, async (trx) => {
      await expect(
        trx
          .insertInto("notification_outbox")
          .values({
            ...message(await seedEvent(trx)),
            provider_message_id: "ses-1",
            sent_at: new Date(),
          })
          .execute(),
      ).rejects.toThrow(/notification_outbox_sent_check/);
    });
  });

  it("cascades: deleting the event removes its queued messages", async () => {
    await withRollback(db, async (trx) => {
      const eventId = await seedEvent(trx);
      await trx
        .insertInto("notification_outbox")
        .values(message(eventId))
        .execute();

      await trx
        .deleteFrom("notification_events")
        .where("id", "=", eventId)
        .execute();

      const left = await trx
        .selectFrom("notification_outbox")
        .selectAll()
        .execute();
      expect(left).toHaveLength(0);
    });
  });
});
