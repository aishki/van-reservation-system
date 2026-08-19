import path from "path";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import fs from "fs";
import https from "https";
import {
  SESv2Client,
  SendEmailCommand,
  type SendEmailCommandInput,
} from "@aws-sdk/client-sesv2";
import { err, ok, type Result } from "@/lib/result";
import {
  type EmailError,
  type EmailFailure,
  type EmailMessage,
  emailError,
  type MailTransport,
  type SentMessage,
} from "@/modules/email/transport";

/**
 * The one SES call this transport makes. Injectable so tests script SES
 * responses/errors without a network or a real client (mirrors how
 * `CgsAuthProvider` injects `fetch`). Returns the shape we read off SES's
 * `SendEmailCommandOutput`.
 */
export type SesSend = (
  input: SendEmailCommandInput,
) => Promise<{ MessageId?: string }>;

export interface SesTransportConfig {
  region: string;
  /**
   * Omit BOTH key fields to authenticate through the AWS SDK's default
   * credential chain (named profile, SSO session, instance or task role). That
   * is the deployment path and the one that refreshes itself; explicit keys are
   * for a developer with a pasted pair.
   */
  accessKeyId?: string;
  secretAccessKey?: string;
  /** Required alongside TEMPORARY (`ASIA…`) keys; absent for permanent ones. */
  sessionToken?: string;
  /** Verified SES sender identity, e.g. `Van Reservation <no-reply@…>`. */
  from: string;
  /** Optional default Reply-To; a message's own `replyTo` overrides it. */
  replyTo?: string;
  /** Injectable for tests; defaults to a real SESv2 `SendEmailCommand` call. */
  sendCommand?: SesSend;
}

// SES exception names that mean "do not retry this message unchanged" — the
// recipient, sender identity, or account is the problem, not a transient blip.
const PERMANENT = new Set([
  "MessageRejected",
  "MailFromDomainNotVerifiedException",
  "AccountSuspendedException",
  "SendingPausedException",
  "BadRequestException",
  // Credential and permission failures. These arrive as 403, which no rule
  // below caught, so they used to be classified SERVICE_UNAVAILABLE and retried
  // for hours — reporting a misconfiguration as a provider outage and burying
  // the cause. Nothing about the message will make a wrong key work.
  "AccessDeniedException",
  "UnrecognizedClientException",
  "InvalidClientTokenId",
  "InvalidSignatureException",
  "SignatureDoesNotMatch",
  "ExpiredTokenException",
  "ExpiredToken",
]);

// SES exception names that mean "you are going too fast / over quota" — retry
// with backoff rather than giving up.
const THROTTLED = new Set([
  "ThrottlingException",
  "TooManyRequestsException",
  "LimitExceededException",
]);

/**
 * What SES said, for a human reading `notification_outbox.last_error` later.
 * Name and message both, because either alone is routinely useless: the name
 * is absent on network errors, and the message is absent on several of SES's
 * own exceptions.
 */
function describe(error: unknown): string | undefined {
  const name = (error as { name?: string })?.name;
  const message = (error as { message?: string })?.message;
  const status = (error as { $metadata?: { httpStatusCode?: number } })
    ?.$metadata?.httpStatusCode;

  const parts = [
    name,
    message,
    status === undefined ? undefined : `HTTP ${status}`,
  ].filter((part): part is string => typeof part === "string" && part !== "");

  return parts.length === 0 ? undefined : parts.join(" — ");
}

/**
 * Translates a thrown SES error into one of our failure codes. Named exceptions
 * win; the HTTP status is a fallback for anything unnamed. Everything else —
 * network errors, timeouts, 5xx — is transient (`SERVICE_UNAVAILABLE`).
 *
 * 403 is PERMANENT and deliberately so. It means the credentials are wrong,
 * expired, or unauthorised for `ses:SendEmail`, and no amount of retrying makes
 * a bad key good; treating it as transient hid a missing session token behind
 * eight hours of backoff. An operator has to act, so the row should say so at
 * once rather than converge on the same answer much later.
 */
function classify(error: unknown): EmailFailure {
  const name = (error as { name?: string })?.name ?? "";
  const status = (error as { $metadata?: { httpStatusCode?: number } })
    ?.$metadata?.httpStatusCode;

  if (THROTTLED.has(name) || status === 429) return "RATE_LIMITED";
  if (PERMANENT.has(name) || status === 400 || status === 403) {
    return "EMAIL_REJECTED";
  }
  return "SERVICE_UNAVAILABLE";
}

/**
 * The `SESv2Client` constructor argument.
 *
 * Exported and pure so the credential decision — the part that silently broke
 * sending — is unit-testable without constructing an AWS client or reaching a
 * network.
 *
 * `credentials` is OMITTED, not present-and-empty, when no key was supplied:
 * passing the property at all opts OUT of the SDK's default credential chain,
 * so an explicit-but-blank object authenticates as nobody rather than falling
 * back to the profile or instance role that is actually available.
 */
export function sesClientConfig(config: SesTransportConfig): {
  region: string;
  credentials?: {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
  };
} {
  if (!config.accessKeyId || !config.secretAccessKey) {
    return { region: config.region };
  }
  return {
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      // Undefined for a permanent (`AKIA…`) key, which is what the SDK expects.
      // Temporary (`ASIA…`) credentials WITHOUT it are rejected 403 on every
      // call — the failure this function exists to make impossible to reproduce.
      ...(config.sessionToken ? { sessionToken: config.sessionToken } : {}),
    },
  };
}

function defaultSend(config: SesTransportConfig): SesSend {
  // Dynamically look for the certificate in the project root directory
  const certPath = path.join(process.cwd(), "company-root.crt");
  
  let requestHandler: NodeHttpHandler | undefined;

  try {
    if (fs.existsSync(certPath)) {
      const corporateCertificate = fs.readFileSync(certPath);
      
      requestHandler = new NodeHttpHandler({
        httpsAgent: new https.Agent({
          ca: [corporateCertificate],
          keepAlive: true, // Reuses connections for better performance
        }),
      });
    } else {
      console.warn(`[SES Client] Certificate not found at root path: ${certPath}. Proceeding with system defaults.`);
    }
  } catch (e) {
    console.error("Failed to load corporate root certificate:", e);
  }

  const clientConfig: any = sesClientConfig(config);
  
  if (requestHandler) {
    clientConfig.requestHandler = requestHandler;
  }

  // Built once and captured, so a single client (and its connection pool) is
  // reused across sends rather than reconstructed per message.
  const client = new SESv2Client(clientConfig);
  return (input) => client.send(new SendEmailCommand(input));
}


/**
 * Sends mail through Amazon SES (v2). Assumes a structurally-valid message —
 * `service.sendEmail` validates before delegating here — and focuses on the
 * provider call and mapping SES's failure taxonomy onto ours.
 */
export class SesTransport implements MailTransport {
  private readonly from: string;
  private readonly replyTo?: string;
  private readonly sendCommand: SesSend;

  constructor(config: SesTransportConfig) {
    this.from = config.from;
    this.replyTo = config.replyTo;
    this.sendCommand = config.sendCommand ?? defaultSend(config);
  }

  async send(message: EmailMessage): Promise<Result<SentMessage, EmailError>> {
    const to = Array.isArray(message.to) ? message.to : [message.to];
    const cc = message.cc ?? [];
    const replyTo = message.replyTo ?? this.replyTo;

    try {
      const res = await this.sendCommand({
        FromEmailAddress: this.from,
        Destination: {
          ToAddresses: to,
          // Omitted rather than sent empty: SES accepts `CcAddresses: []`, but
          // an empty header is noise in every recipient's client.
          ...(cc.length > 0 ? { CcAddresses: cc } : {}),
        },
        ...(replyTo ? { ReplyToAddresses: [replyTo] } : {}),
        Content: {
          Simple: {
            Subject: { Data: message.subject },
            Body: {
              Html: { Data: message.html },
              Text: { Data: message.text },
            },
          },
        },
      });
      return ok({ id: res.MessageId ?? "" });
    } catch (error) {
      return err(emailError(classify(error), describe(error)));
    }
  }
}
