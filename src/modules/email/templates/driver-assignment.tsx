import { Hr, Link, Text } from "@react-email/components";
import { render } from "@react-email/render";
import { EM_DASH } from "@/lib/tz";
import {
  RequestInformation,
  type RequestInformationInput,
  type RequestTrip,
} from "@/modules/email/templates/request-information";
import { EmailShell } from "@/modules/email/templates/shell";
import { styles } from "@/modules/email/templates/styles";
import type { EmailBody } from "@/modules/email/transport";

/**
 * Sent to the REQUESTOR when a trip's van assignment is set, or when it changes.
 *
 * Separate from `booking-status-change.tsx` because this is NOT a status change:
 * the reservation stays Approved either way. It also carries the assignment's
 * own details, which would be noise in a rejection and meaningless in a
 * cancellation.
 *
 * The copy says "van assignment", never "driver": van and driver are assigned
 * INDEPENDENTLY, so one notice has to be truthful whether the van moved, the
 * driver moved, or both. The template id and the `change` values keep their
 * older `driver` spelling because they are stored and keyed, not read.
 *
 * Each trip carries its own assignment (see `RequestDriver`) — a three-date
 * standby block can be covered by three drivers, and the same driver may take a
 * different unit on a different day. Which of the two sides is a rental is NOT
 * disclosed: the requestor is given a name, a mobile and a plate so they can
 * meet their van.
 */
export type DriverAssignmentInput = RequestInformationInput & {
  manageUrl: string;
  /** First assignment, or a replacement for one already communicated. */
  change: "assigned" | "changed";
};

/**
 * `change` is a stored payload value, so it keeps saying "assigned"; the copy
 * says "set", which is what reads naturally after "van assignment".
 */
const wording = (change: "assigned" | "changed") =>
  change === "changed" ? "changed" : "set";

/**
 * Is there a number here to phone?
 *
 * Van and driver are assigned INDEPENDENTLY, so a van-only assignment fires this
 * mail with the driver half of the card dashed (`loadRequestInformation` cannot
 * leave it blank — the payload's strings are `min(1)`). Telling a requestor to
 * ring an em dash is the same falsehood as heading a van change "Driver
 * changed", so the sentence that says to ring one is conditional on there being
 * one.
 */
const hasDriverMobile = (trip: RequestTrip): boolean =>
  trip.driver !== undefined && trip.driver.mobile.trim() !== EM_DASH;

export function DriverAssignmentEmail(input: DriverAssignmentInput) {
  const changed = input.change === "changed";
  const total = input.trips.length;

  return (
    <EmailShell
      preview={`Van assignment ${wording(input.change)} — ${input.trips[0]?.referenceId ?? ""} in ${input.site}`}
      heading={changed ? "Van assignment changed" : "Van assignment set"}
      lead={
        changed ? (
          <>
            Hi {input.requestor.name}, the van assignment for your reservation
            has changed. Your booking is <strong>still approved</strong> — only
            the van or its driver is different. The current details are below.
          </>
        ) : (
          <>
            Hi {input.requestor.name}, your approved van reservation has been
            assigned. Your booking is <strong>still approved</strong>; the
            assignment details are below.
          </>
        )
      }
    >
      <RequestInformation
        site={input.site}
        rideMode={input.rideMode}
        requestor={input.requestor}
        trips={input.trips}
      />

      <Hr style={styles.hr} />
      <Text style={styles.footer}>
        {/* `every`, not `some`: the multi-trip sentence claims each card names a
            driver, so one dashed trip drops the line rather than half-lying. */}
        {input.trips.every(hasDriverMobile) && (
          <>
            {total === 1
              ? "Contact the driver directly on the number above if your plans change."
              : "Each trip above shows its own driver — they may differ between dates."}{" "}
          </>
        )}
        See the full details at{" "}
        <Link href={input.manageUrl} style={styles.link}>
          the Van Reservation website
        </Link>
        .
      </Text>
    </EmailShell>
  );
}

export async function renderDriverAssignment(
  input: DriverAssignmentInput,
): Promise<EmailBody> {
  const element = <DriverAssignmentEmail {...input} />;
  const [html, text] = await Promise.all([
    render(element),
    render(element, { plainText: true }),
  ]);
  return {
    // Human-facing like the heading, so it is worded the same way.
    subject: `Van reservation ${input.trips[0]?.referenceId ?? ""} — van assignment ${wording(input.change)}`,
    html,
    text,
  };
}
