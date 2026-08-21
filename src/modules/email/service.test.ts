import { describe, expect, it, vi } from "vitest";
import { err, ok } from "@/lib/result";
import {
  type EmailMessage,
  emailError,
  type MailTransport,
} from "@/modules/email/transport";

// `sendEmail` resolves `EMAIL_ALWAYS_CC` from the environment when the caller
// omits it, so the default path is exercised here rather than bypassed by
// always passing a list. Mutable so one suite below can set a standing copy and
// prove it reaches the transport through the real default.
const alwaysCc = { value: [] as string[] };

vi.mock("@/lib/env", () => ({
  env: () => ({ EMAIL_ALWAYS_CC: alwaysCc.value }),
}));

const { sendBookingStatusChange, sendEmail } = await import(
  "@/modules/email/service"
);

const valid: EmailMessage = {
  to: "a@example.com",
  subject: "Hi",
  html: "<p>x</p>",
  text: "x",
};

function fakeTransport(): MailTransport & { calls: EmailMessage[] } {
  const calls: EmailMessage[] = [];
  return {
    calls,
    send: async (message) => {
      calls.push(message);
      return ok({ id: "sent-1" });
    },
  };
}

describe("sendEmail", () => {
  it("delegates a well-formed message to the transport", async () => {
    const transport = fakeTransport();
    await expect(sendEmail(transport, valid)).resolves.toEqual({
      ok: true,
      value: { id: "sent-1" },
    });
    expect(transport.calls).toHaveLength(1);
  });

  it.each<EmailMessage>([
    { ...valid, to: "" },
    { ...valid, to: [] },
    { ...valid, to: ["a@example.com", "   "] },
    { ...valid, subject: "  " },
    { ...valid, html: "" },
    { ...valid, text: "" },
  ])(
    "rejects a malformed message with VALIDATION_FAILED without touching the transport (%#)",
    async (message) => {
      const transport = fakeTransport();
      await expect(sendEmail(transport, message)).resolves.toEqual({
        ok: false,
        error: { code: "VALIDATION_FAILED" },
      });
      expect(transport.calls).toHaveLength(0);
    },
  );
});

// Module scope: the EMAIL_ALWAYS_CC suite sends this through
// `sendBookingStatusChange` too, to prove the wrapper cannot drop the copy.
const input = {
  status: "Approved" as const,
  site: "Iloilo",
  rideMode: "Pickup / Drop-off",
  requestor: {
    name: "Juan Cruz",
    email: "juan@example.com",
    mobile: "0917 123 4567",
  },
  manageUrl: "http://localhost:3000/manage",
  trips: [
    {
      mode: "pickup" as const,
      referenceId: "VR-1042",
      purpose: "Client visit",
      details: "Quarterly review with the account team.",
      pickup: "Mon, 10 Aug 2026, 7:30 AM",
      pickupPoint: "Smallville",
      dropoffPoint: "CGS Office",
      passengers: [{ name: "Juan Cruz", domainId: "AB12345" }],
    },
  ],
};

describe("sendBookingStatusChange", () => {
  it("renders the template and sends it to the requestor", async () => {
    const transport = fakeTransport();
    const result = await sendBookingStatusChange(
      transport,
      "juan@example.com",
      input,
    );

    expect(result.ok).toBe(true);
    expect(transport.calls).toHaveLength(1);

    const sent = transport.calls[0];
    expect(sent.to).toBe("juan@example.com");
    expect(sent.subject).toContain("VR-1042");
    expect(sent.subject).toContain("Approved");
    expect(sent.html).toContain("Juan Cruz");
    expect(sent.html).toContain("Iloilo");
    expect(sent.text).toContain("VR-1042");
  });

  it("copies the admins it is given", async () => {
    const transport = fakeTransport();
    await sendBookingStatusChange(transport, "juan@example.com", input, [
      "ivy.balandra@carelon.com",
      "ruwijoy.eribal@carelon.com",
    ]);

    expect(transport.calls[0].cc).toEqual([
      "ivy.balandra@carelon.com",
      "ruwijoy.eribal@carelon.com",
    ]);
  });

  it("defaults to no cc rather than an empty header when none are given", async () => {
    const transport = fakeTransport();
    await sendBookingStatusChange(transport, "juan@example.com", input);
    expect(transport.calls[0].cc).toEqual([]);
  });
});

describe("sendEmail cc validation", () => {
  it("refuses a message carrying a blank cc entry", async () => {
    const transport = { send: vi.fn() };
    const result = await sendEmail(transport, {
      to: "juan@example.com",
      cc: ["ivy@example.com", "   "],
      subject: "Approved",
      html: "<p>hi</p>",
      text: "hi",
    });

    expect(result).toEqual(err(emailError("VALIDATION_FAILED")));
    expect(transport.send).not.toHaveBeenCalled();
  });

  it("accepts an absent or empty cc", async () => {
    const transport = { send: vi.fn().mockResolvedValue(ok({ id: "1" })) };
    for (const cc of [undefined, []]) {
      expect(
        await sendEmail(transport, {
          to: "juan@example.com",
          cc,
          subject: "Received",
          html: "<p>hi</p>",
          text: "hi",
        }),
      ).toEqual(ok({ id: "1" }));
    }
  });
});

/**
 * The standing copy required of every notification — one address the client
 * needs on all outbound mail, applied at the only function every message
 * passes through so no template or enqueue site can omit it.
 */
describe("sendEmail EMAIL_ALWAYS_CC", () => {
  it("copies the standing addresses on a message that had no cc", async () => {
    const transport = fakeTransport();
    await sendEmail(transport, valid, ["standing@example.com"]);
    expect(transport.calls[0].cc).toEqual(["standing@example.com"]);
  });

  it("appends after the caller's own cc rather than replacing it", async () => {
    const transport = fakeTransport();
    await sendEmail(transport, { ...valid, cc: ["ivy@example.com"] }, [
      "standing@example.com",
    ]);
    expect(transport.calls[0].cc).toEqual([
      "ivy@example.com",
      "standing@example.com",
    ]);
  });

  // SES delivers to an address present in both To and Cc twice, and the
  // standing recipient is the likeliest person to already be a site's admin
  // recipient.
  it("does not copy someone already on the message", async () => {
    const transport = fakeTransport();
    await sendEmail(
      transport,
      { to: ["a@example.com"], cc: ["ivy@example.com"], ...bodyOf(valid) },
      ["A@Example.com", "IVY@example.com"],
    );
    expect(transport.calls[0].cc).toEqual(["ivy@example.com"]);
  });

  it("contributes a repeated standing address once", async () => {
    const transport = fakeTransport();
    await sendEmail(transport, valid, [
      "standing@example.com",
      "Standing@Example.com",
    ]);
    expect(transport.calls[0].cc).toEqual(["standing@example.com"]);
  });

  // A misconfigured variable must not be able to fail a valid notification.
  it("drops blank standing entries instead of failing the message", async () => {
    const transport = fakeTransport();
    const result = await sendEmail(transport, valid, ["  ", ""]);
    expect(result.ok).toBe(true);
    expect(transport.calls[0].cc).toBeUndefined();
  });

  it("leaves the message untouched when nobody is standing", async () => {
    const transport = fakeTransport();
    await sendEmail(transport, valid, []);
    expect(transport.calls[0].cc).toBeUndefined();
  });

  // The default argument, not an explicit list — this is what proves a caller
  // that knows nothing about the setting still sends the copy.
  it("reaches the transport through the environment default", async () => {
    alwaysCc.value = ["standing@example.com"];
    try {
      const transport = fakeTransport();
      await sendEmail(transport, valid);
      expect(transport.calls[0].cc).toEqual(["standing@example.com"]);

      const wrapped = fakeTransport();
      await sendBookingStatusChange(wrapped, "juan@example.com", input);
      expect(wrapped.calls[0].cc).toEqual(["standing@example.com"]);
    } finally {
      alwaysCc.value = [];
    }
  });

  it("never copies anyone on a message it refuses", async () => {
    const transport = fakeTransport();
    await sendEmail(transport, { ...valid, to: "" }, ["standing@example.com"]);
    expect(transport.calls).toHaveLength(0);
  });
});

function bodyOf(message: EmailMessage) {
  return { subject: message.subject, html: message.html, text: message.text };
}
