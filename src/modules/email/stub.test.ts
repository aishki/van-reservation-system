import { describe, expect, it, vi } from "vitest";
import type { Env } from "@/lib/env";
import { StubTransport } from "@/modules/email/stub";
import type { EmailMessage } from "@/modules/email/transport";

const message: EmailMessage = {
  to: "a@example.com",
  subject: "Hi",
  html: "<p>x</p>",
  text: "x",
};

describe("StubTransport", () => {
  it("captures each message and returns an incrementing stub id, never sending", async () => {
    const logger = vi.fn();
    const transport = new StubTransport("test", { logger });

    await expect(transport.send(message)).resolves.toEqual({
      ok: true,
      value: { id: "stub-1" },
    });
    await expect(
      transport.send({ ...message, to: ["b@example.com", "c@example.com"] }),
    ).resolves.toEqual({ ok: true, value: { id: "stub-2" } });

    expect(transport.sent).toHaveLength(2);
    expect(transport.sent[0]).toEqual(message);
    expect(logger).toHaveBeenCalledTimes(2);
    expect(logger.mock.calls[1][0]).toContain("b@example.com, c@example.com");
  });

  it("constructs under development and test", () => {
    expect(() => new StubTransport("development")).not.toThrow();
    expect(() => new StubTransport("test")).not.toThrow();
  });

  it("refuses to construct in production", () => {
    expect(() => new StubTransport("production")).toThrow(/StubTransport/);
  });

  // Allowlist, not blocklist: anything that is not an expressly permitted
  // non-production environment must refuse (see the note in stub.ts).
  it.each(["", "Production", "staging", undefined])(
    "refuses the unrecognized environment %o",
    (value) => {
      expect(
        () => new StubTransport(value as unknown as Env["NODE_ENV"]),
      ).toThrow(/StubTransport/);
    },
  );
});

describe("StubTransport cc", () => {
  it("names the copied recipients in the log line", async () => {
    const logger = vi.fn();
    const transport = new StubTransport("test", { logger });

    await transport.send({
      to: "juan@example.com",
      cc: ["ivy@example.com", "ruwi@example.com"],
      subject: "Approved",
      html: "<p>hi</p>",
      text: "hi",
    });

    const line = logger.mock.calls[0][0] as string;
    expect(line).toContain("→ juan@example.com");
    expect(line).toContain("cc: ivy@example.com, ruwi@example.com");
  });

  it("says nothing about cc when there is none", async () => {
    const logger = vi.fn();
    const transport = new StubTransport("test", { logger });

    await transport.send({
      to: "juan@example.com",
      cc: [],
      subject: "Received",
      html: "<p>hi</p>",
      text: "hi",
    });

    expect(logger.mock.calls[0][0] as string).not.toContain("cc:");
  });
});
