import { env } from "@/lib/env";
import { selectMailTransport } from "@/modules/email/select-transport";
import { sendEmail } from "@/modules/email/service";
import { devOnly } from "../preview";

/**
 * Sends ONE real message through the app's own transport and reports exactly
 * what the provider said.
 *
 * `GET /api/dev/email/probe?to=you@example.com`
 *
 * This exists because diagnosing a send failure through the outbox is slow and
 * indirect: submit a booking, wait for `after()`, query `notification_outbox`,
 * and read a code that — until this endpoint's sibling changes — did not name
 * the cause. A wrong AWS key cost hours that way. Here the answer is one
 * request, and the failure detail comes back in the response body.
 *
 * It deliberately uses `selectMailTransport(env())` rather than building its
 * own client, so what it proves is the CONFIGURATION THE APP WILL USE. A probe
 * with its own credentials would answer a question nobody asked.
 *
 * Development only — the same `devOnly` guard as the previews. It sends real
 * mail on a box configured for SES, so it takes an explicit recipient and never
 * defaults to one.
 */
export async function GET(req: Request) {
  const blocked = devOnly();
  if (blocked) return blocked;

  const to = new URL(req.url).searchParams.get("to")?.trim();
  if (!to) {
    return Response.json(
      { error: "Pass ?to=<address>. This sends a real message." },
      { status: 400 },
    );
  }

  const config = env();
  const transport = selectMailTransport(config);
  if (transport === null) {
    return Response.json(
      {
        error:
          "No transport. EMAIL_MODE=ses needs AWS_REGION and EMAIL_FROM; see .env.example.",
        emailMode: config.EMAIL_MODE,
      },
      { status: 500 },
    );
  }

  // Reported so a "sent" result that arrives nowhere is still diagnosable: in
  // stub mode nothing reaches a provider, and that is the likeliest surprise.
  const configured = {
    emailMode: config.EMAIL_MODE,
    region: config.AWS_REGION ?? null,
    from: config.EMAIL_FROM ?? null,
    // Never the key itself. The PREFIX is the diagnostic — `ASIA` marks
    // temporary credentials, which need AWS_SESSION_TOKEN, and `AKIA` a
    // permanent one, which must not have it.
    credentials: config.AWS_ACCESS_KEY_ID
      ? {
          keyPrefix: config.AWS_ACCESS_KEY_ID.slice(0, 4),
          sessionToken: config.AWS_SESSION_TOKEN ? "set" : "absent",
        }
      : "AWS default credential chain (no explicit key)",
  };

  const result = await sendEmail(transport, {
    to,
    subject: "Van Reservation — SES probe",
    html: "<p>If you are reading this, SES is configured correctly.</p>",
    text: "If you are reading this, SES is configured correctly.",
  });

  if (result.ok) {
    return Response.json({
      ok: true,
      providerMessageId: result.value.id,
      configured,
    });
  }

  return Response.json(
    {
      ok: false,
      code: result.error.code,
      // The whole point: the provider's own exception name and message.
      detail: result.error.detail ?? null,
      configured,
    },
    { status: 502 },
  );
}
