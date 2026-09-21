import { Hr, Link, Section, Text } from "@react-email/components";
import { render } from "@react-email/render";
import {
  type EmailAudience,
  RequestInformation,
  type RequestInformationInput,
} from "@/modules/email/templates/request-information";
import { EmailShell } from "@/modules/email/templates/shell";
import { styles } from "@/modules/email/templates/styles";
import type { EmailBody } from "@/modules/email/transport";

/**
 * One template for every decided status: Approved, Rejected, Cancelled, No
 * Show.
 *
 * These are the same email — "your request moved to X, log in for the full
 * details" — differing only in a heading, a sentence, and whether there is a
 * reason to quote. Separate files would be copies of one layout, drifting the
 * first time the footer changed.
 *
 * Reverting a no-show back to Approved reuses `{ status: "Approved" }` rather
 * than a fifth variant: it IS the approved-outcome email, sent again because
 * the outcome is true again. Nothing about the approved copy claims to be a
 * FIRST approval.
 *
 * Driver assignment is deliberately NOT here (`driver-assignment.tsx`). It is not
 * a status change — the status stays Approved — and it needs the van's details,
 * which have no meaning in a rejection.
 *
 * Covers ONE reservation. A submission's trips are decided independently, so a
 * three-trip submission can yield one rejection and two approvals.
 */
type StatusDetail =
  | { status: "Approved" }
  | { status: "Rejected"; rejectionReason: string }
  | {
      status: "Cancelled";
      /** Mirrors `cancelled_by_role`; decides whose name appears. */
      cancelledBy: "associate" | "admin_support";
      cancellationReason: string;
    }
  /**
   * The van and driver were committed; the passenger never boarded. No
   * reason field — unlike a rejection or a cancellation, there is nothing
   * for the admin to explain, only a fact to record. Reversible: see the
   * module comment above.
   */
  | { status: "No Show" };

export type BookingStatusChangeInput = RequestInformationInput & {
  /** Absolute link back to the requestor's bookings (built from APP_URL). */
  manageUrl: string;
  /** Passenger copies get a badge and drop the admin-cc footer line. */
  audience?: EmailAudience;
} & StatusDetail;

/**
 * Tint per outcome: approval reads as good news, rejection as bad, cancellation
 * as neutral. No Show has no `reason` block (see `reasonOf`) so this entry is
 * never actually painted — it exists because `TONE[input.status]` is indexed
 * over all four statuses regardless.
 */
const TONE = {
  Approved: { bg: "#eef7f0", accent: "#1c7a3e" },
  Rejected: { bg: "#fdf0f0", accent: "#b3261e" },
  Cancelled: { bg: "#f5f5f5", accent: "#666666" },
  "No Show": { bg: "#fdf3e2", accent: "#a15c00" },
} as const;

function reasonOf(input: BookingStatusChangeInput): string | null {
  if (input.status === "Rejected") return input.rejectionReason;
  if (input.status === "Cancelled") return input.cancellationReason;
  return null;
}

function leadOf(input: BookingStatusChangeInput) {
  if (input.status === "Approved") {
    return (
      <>
        Hi {input.requestor.name}, your van reservation has been{" "}
        <strong>approved</strong>. Log in to the Van Reservation website to see
        the full details.
      </>
    );
  }
  if (input.status === "Rejected") {
    return (
      <>
        Hi {input.requestor.name}, your van reservation could not be approved.
        Log in to the Van Reservation website to see the full details.
      </>
    );
  }
  if (input.status === "No Show") {
    return (
      <>
        Hi {input.requestor.name}, your van reservation has been marked as a{" "}
        <strong>no-show</strong> — the van and driver were ready, but no
        passenger boarded. Log in to the Van Reservation website to see the full
        details.
      </>
    );
  }
  return input.cancelledBy === "admin_support" ? (
    <>
      Hi {input.requestor.name}, your van reservation has been cancelled by{" "}
      Admin Support. Log in to the Van Reservation website to see the full
      details.
    </>
  ) : (
    <>
      This is to inform you that <strong>{input.requestor.name}</strong> has
      cancelled their van reservation. Log in to the Van Reservation website to
      see the full details.
    </>
  );
}

const HEADINGS = {
  Approved: "Van reservation approved",
  Rejected: "Van reservation not approved",
  Cancelled: "Van reservation cancelled",
  "No Show": "Van reservation marked No Show",
} as const;

export function BookingStatusChangeEmail(input: BookingStatusChangeInput) {
  const tone = TONE[input.status];
  const reason = reasonOf(input);
  const isPassenger = input.audience === "passenger";

  return (
    <EmailShell
      preview={`${input.status} — ${input.trips[0]?.referenceId ?? ""} in ${input.site}`}
      heading={HEADINGS[input.status]}
      badge={isPassenger ? "Passenger Copy" : undefined}
      lead={leadOf(input)}
    >
      {reason !== null && (
        <Section
          style={{
            backgroundColor: tone.bg,
            borderRadius: "12px",
            padding: "18px 20px",
            margin: "22px 0",
          }}
        >
          <Text
            style={{
              fontSize: "12px",
              fontWeight: 600,
              color: tone.accent,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              margin: "0 0 6px",
            }}
          >
            Reason
          </Text>
          <Text
            style={{
              fontSize: "15px",
              lineHeight: "22px",
              color: "#2b1b49",
              margin: "0",
            }}
          >
            {reason}
          </Text>
        </Section>
      )}

      <RequestInformation
        site={input.site}
        rideMode={input.rideMode}
        requestor={input.requestor}
        trips={input.trips}
        showCosting
      />

      <Hr style={styles.hr} />
      <Text style={styles.footer}>
        See the full details at{" "}
        <Link href={input.manageUrl} style={styles.link}>
          the Van Reservation website
        </Link>
        .{" "}
        {/* Only true for the requestor's own copy — a passenger copy carries
            no cc, so saying so here would misstate who else got this mail. */}
        {!isPassenger &&
          "Your site's Admin Support team is copied on this email."}
      </Text>
    </EmailShell>
  );
}

export async function renderBookingStatusChange(
  input: BookingStatusChangeInput,
): Promise<EmailBody> {
  const element = <BookingStatusChangeEmail {...input} />;
  const [html, text] = await Promise.all([
    render(element),
    render(element, { plainText: true }),
  ]);
  const subject = `Van reservation ${input.trips[0]?.referenceId ?? ""} — ${input.status}`;
  return {
    subject:
      input.audience === "passenger" ? `${subject} — Passenger Copy` : subject,
    html,
    text,
  };
}
