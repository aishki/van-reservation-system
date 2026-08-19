import type { Env } from "@/lib/env";
import { ok, type Result } from "@/lib/result";
import type {
  EmailError,
  EmailMessage,
  MailTransport,
  SentMessage,
} from "@/modules/email/transport";

// Allowlist, deliberately — NOT `nodeEnv !== "production"`. A blocklist fails
// OPEN: it would admit the stub for `undefined`, `""`, a typo, or any future
// environment name. A stub in production silently DROPS every email, so this
// guard is what turns that silent data-loss into a loud boot failure (same
// stance as StubAuthProvider).
const STUB_PERMITTED_ENVIRONMENTS = new Set<string>(["development", "test"]);

export interface StubTransportOptions {
  /**
   * Called with a one-line summary of each captured message. Defaults to
   * `console.info` so a developer sees what would have been sent; pass a no-op
   * to silence it (tests do).
   */
  logger?: (line: string) => void;
}

/**
 * A no-send transport for development and tests: it records every message in
 * `sent` and logs a summary, but never contacts a provider. It cannot report a
 * transient failure (there is no network), so it always succeeds.
 */
export class StubTransport implements MailTransport {
  /** Every message handed to `send`, in order — for assertions and dev inspection. */
  readonly sent: EmailMessage[] = [];
  private readonly logger: (line: string) => void;

  constructor(nodeEnv: Env["NODE_ENV"], options: StubTransportOptions = {}) {
    if (!STUB_PERMITTED_ENVIRONMENTS.has(nodeEnv)) {
      throw new Error(
        "StubTransport must never be used in production — set EMAIL_MODE=ses",
      );
    }
    // console.info in dev is the point — the stub exists to surface what would
    // have been sent. Callers that want silence pass their own logger.
    this.logger = options.logger ?? ((line: string) => console.info(line));
  }

  async send(message: EmailMessage): Promise<Result<SentMessage, EmailError>> {
    this.sent.push(message);
    const id = `stub-${this.sent.length}`;
    const to = Array.isArray(message.to) ? message.to.join(", ") : message.to;
    // The cc is in the line because "who else got this" is the question the
    // log exists to answer, and it is invisible in `EmailMessage` otherwise.
    const cc = message.cc ?? [];
    const copied = cc.length > 0 ? ` · cc: ${cc.join(", ")}` : "";
    this.logger(`[email:stub] → ${to}${copied} · ${message.subject} (${id})`);
    return ok({ id });
  }
}
