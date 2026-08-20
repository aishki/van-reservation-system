import { Hr, Link, Text } from "@react-email/components";
import { render } from "@react-email/render";
import {
  RequestInformation,
  type RequestInformationInput,
} from "@/modules/email/templates/request-information";
import { EmailShell } from "@/modules/email/templates/shell";
import { styles } from "@/modules/email/templates/styles";
import type { EmailBody } from "@/modules/email/transport";

/**
 * Email #2 — sent to ADMIN SUPPORT when a booking is submitted.
 *
 * Recipients are the site's notifiable admins, resolved by `adminRecipients`
 * (see `../recipients.ts`): this template renders the same body for all of them
 * and knows nothing about who they are.
 */
export interface AdminNewRequestInput extends RequestInformationInput {
  /** Absolute link to the admin dashboard (built from APP_URL). */
  adminUrl: string;
}

export function AdminNewRequestEmail(input: AdminNewRequestInput) {
  const total = input.trips.length;
  const noun = total === 1 ? "trip" : "trips";

  return (
    <EmailShell
      preview={`${input.requestor.name} submitted a van reservation — ${total} ${noun} in ${input.site}`}
      heading="New van reservation"
      lead={
        <>
          This is to inform you that a van reservation has been submitted by{" "}
          <strong>{input.requestor.name}</strong>. Please see the details below:
        </>
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
        Log in to the{" "}
        <Link href={input.adminUrl} style={styles.link}>
          Van Reservation admin dashboard
        </Link>{" "}
        to manage {total === 1 ? "this booking" : "these bookings"} and assign a
        driver.
      </Text>
    </EmailShell>
  );
}

/**
 * The subject leads with the requestor and site because an admin triaging a
 * full inbox sorts on those, not on a reference they have not seen yet.
 */
export async function renderAdminNewRequest(
  input: AdminNewRequestInput,
): Promise<EmailBody> {
  const element = <AdminNewRequestEmail {...input} />;
  const [html, text] = await Promise.all([
    render(element),
    render(element, { plainText: true }),
  ]);

  const total = input.trips.length;
  const subject =
    total === 1
      ? `New van reservation — ${input.requestor.name} (${input.site})`
      : `New van reservation — ${input.requestor.name} (${input.site}), ${total} trips`;

  return { subject, html, text };
}
