import { Hr, Link, Section, Text } from "@react-email/components";
import { render } from "@react-email/render";
import {
  RequestInformation,
  type RequestInformationInput,
} from "@/modules/email/templates/request-information";
import { EmailShell } from "@/modules/email/templates/shell";
import { styles } from "@/modules/email/templates/styles";
import type { EmailBody } from "@/modules/email/transport";

/**
 * Email #1 — sent to the REQUESTOR when a booking is submitted.
 *
 * One mail per submission, not per trip: `submitBooking` writes a reservation
 * per trip, and enqueuing beside each one would drop four near-identical mails
 * into an inbox in the same second. See `../NOTIFICATIONS.md` §2.
 */
export interface BookingSubmittedInput extends RequestInformationInput {
  /** Absolute link back to the requestor's bookings (built from APP_URL). */
  manageUrl: string;
}

const pending = {
  box: {
    backgroundColor: "#f4edff",
    borderRadius: "12px",
    padding: "18px 20px",
    margin: "22px 0",
  },
  label: {
    fontSize: "12px",
    fontWeight: 600,
    color: "#5009b5",
    textTransform: "uppercase" as const,
    letterSpacing: "0.06em",
    margin: "0 0 6px",
  },
  text: {
    fontSize: "15px",
    lineHeight: "22px",
    color: "#2b1b49",
    margin: "0",
  },
} as const;

export function BookingSubmittedEmail(input: BookingSubmittedInput) {
  const total = input.trips.length;
  const noun = total === 1 ? "trip" : "trips";

  return (
    <EmailShell
      preview={`Received — ${total} ${noun} in ${input.site}, pending approval`}
      heading="We received your request"
      lead={
        <>
          Hi {input.requestor.name}, your van reservation for {total} {noun} in{" "}
          {input.site} has been submitted.
        </>
      }
    >
      {/* The status is the point of this mail, so it gets its own block rather
          than a clause in the paragraph above. */}
      <Section style={pending.box}>
        <Text style={pending.label}>Status · Pending</Text>
        <Text style={pending.text}>
          Your request is now awaiting approval from Admin Support, who will
          assign a driver. You'll get another email once that happens.
        </Text>
      </Section>

      <RequestInformation
        site={input.site}
        rideMode={input.rideMode}
        requestor={input.requestor}
        trips={input.trips}
      />

      <Hr style={styles.hr} />
      <Text style={styles.footer}>
        Track or cancel {total === 1 ? "this request" : "these requests"} any
        time at{" "}
        <Link href={input.manageUrl} style={styles.link}>
          your bookings
        </Link>
        . Access is limited to associates in Iloilo and Manila.
      </Text>
    </EmailShell>
  );
}

/**
 * The subject names the reference only when there is exactly one — six
 * references would push past the ~70 characters most clients show, truncating
 * the part that identifies the mail. They are all in the body regardless.
 */
export async function renderBookingSubmitted(
  input: BookingSubmittedInput,
): Promise<EmailBody> {
  const element = <BookingSubmittedEmail {...input} />;
  const [html, text] = await Promise.all([
    render(element),
    render(element, { plainText: true }),
  ]);

  const total = input.trips.length;
  const subject =
    total === 1
      ? `Van booking ${input.trips[0].referenceId} received — Pending approval`
      : `Van booking request received — ${total} trips, Pending approval`;

  return { subject, html, text };
}
