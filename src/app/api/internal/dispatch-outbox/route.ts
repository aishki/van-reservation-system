import { env } from "@/lib/env";
import { getDb } from "@/modules/db/client";
import { dispatchOutbox } from "@/modules/email/dispatch";
import { selectMailTransport } from "@/modules/email/select-transport";

/**
 * Drains the notification outbox.
 *
 * Scheduler-agnostic on purpose: the deployment target is undecided, so this is
 * an ordinary guarded endpoint any cron can call rather than a platform-specific
 * binding. Idempotent by construction — the claim query inside `dispatchOutbox`
 * IS the lock, so two concurrent calls cannot double-send.
 *
 * Needed IN ADDITION to the `after()` calls on the write routes, which only fire
 * when someone writes: a notification queued while SES was unreachable would
 * otherwise sit pending with nothing to retry it.
 *
 * Lives under `/api/` like the rest — the middleware matcher excludes `api/`, so
 * this is not behind the session redirect. The shared secret is its only guard,
 * which is why an absent secret closes it entirely.
 */
export async function GET(req: Request) {
  const secret = env().DISPATCH_SECRET;
  // Unconfigured means unavailable, not unguarded.
  if (!secret) return new Response(null, { status: 404 });

  if (req.headers.get("x-dispatch-secret") !== secret) {
    return new Response(null, { status: 401 });
  }

  const transport = selectMailTransport(env());
  // Null when EMAIL_MODE=ses but a credential is missing. Nothing to send
  // through, and the queued rows stay pending for a later, configured run.
  if (transport === null) {
    return Response.json({ sent: 0, failed: 0, retrying: 0 });
  }

  return Response.json(await dispatchOutbox(getDb(), transport));
}
