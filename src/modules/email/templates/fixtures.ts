import { ADMIN_WHITELIST_SEED } from "@/modules/auth/admin-whitelist-seed";
import { selectAdminEmails } from "@/modules/email/recipients";
import {
  type AdminNewRequestInput,
  renderAdminNewRequest,
} from "@/modules/email/templates/admin-new-request";
import {
  type BookingStatusChangeInput,
  renderBookingStatusChange,
} from "@/modules/email/templates/booking-status-change";
import {
  type BookingSubmittedInput,
  renderBookingSubmitted,
} from "@/modules/email/templates/booking-submitted";
import {
  type DriverAssignmentInput,
  renderDriverAssignment,
} from "@/modules/email/templates/driver-assignment";
import type { RequestTrip } from "@/modules/email/templates/request-information";
import type { EmailBody } from "@/modules/email/transport";

/**
 * Sample payloads and their renderers, for the dev-only preview at
 * `/api/dev/email`. Not used in production — nothing outside that route imports
 * this file.
 *
 * Each entry closes over its OWN typed input rather than the map holding a union
 * of every template's payload. That keeps each fixture type-checked against the
 * template it feeds: change `BookingSubmittedInput` and this file stops
 * compiling, which is the point. A `Record<string, (payload: unknown) => …>` —
 * the shape `NOTIFICATIONS.md` §4 needs for the dispatcher, where the payload
 * genuinely arrives as untyped jsonb — would not catch that.
 *
 * `to` / `cc` are sample ADDRESSING, rendered as a header strip by the preview
 * route. Who really receives each mail is decided by `../recipients.ts`; these
 * values exist so the routing is visible while looking at a template, which is
 * otherwise invisible until the outbox lands.
 */
export interface Preview {
  /** Shown in the index listing. */
  title: string;
  to: string;
  cc: string[];
  render: () => Promise<EmailBody>;
}

const REQUESTOR = {
  name: "Arielle Jimera",
  email: "arielle.jimera@carelon.com",
  mobile: "0917 123 4567",
};

/**
 * Resolved from `ADMIN_WHITELIST_SEED` through the SAME function the live path
 * uses, excluding the requestor exactly as `adminRecipients` would. Hand-typing
 * these was the bug this replaces: the strip would keep claiming an address list
 * that the whitelist had since changed, and the preview would lie confidently.
 */
const ILOILO_ADMINS = selectAdminEmails(
  ADMIN_WHITELIST_SEED,
  "Iloilo",
  REQUESTOR.email,
);

const MANILA_ADMINS = selectAdminEmails(
  ADMIN_WHITELIST_SEED,
  "Manila",
  REQUESTOR.email,
);

const trips: RequestTrip[] = [
  {
    mode: "pickup",
    referenceId: "VR-1042",
    purpose: "Client visit — Smallville branch",
    details: "Quarterly review with the Smallville account team.",
    pickup: "Mon, 10 Aug 2026, 7:30 AM",
    pickupPoint: "CGS Office Iloilo",
    dropoffPoint: "Smallville Complex",
    passengers: [
      { name: "Arielle Jimera", domainId: "AM65108" },
      { name: "Marco Dizon", domainId: "AM10394" },
    ],
  },
  {
    mode: "pickup",
    referenceId: "VR-1043",
    purpose: "Site inspection",
    details: "Walkthrough of the Megaworld build-out with facilities.",
    pickup: "Tue, 11 Aug 2026, 6:00 AM",
    pickupPoint: "CGS Office Iloilo",
    dropoffPoint: "Megaworld Boulevard",
    passengers: [{ name: "Kaye Reyes", domainId: "AK47281" }],
  },
  {
    mode: "pickup",
    referenceId: "VR-1044",
    purpose: "Airport run",
    details: "Dropping off the visiting auditors for their evening flight.",
    pickup: "Wed, 12 Aug 2026, 4:15 PM",
    pickupPoint: "CGS Office Iloilo",
    dropoffPoint: "Iloilo International Airport",
    passengers: [
      { name: "Liza Salcedo", domainId: "AL55210" },
      { name: "Marco Dizon", domainId: "AM10394" },
      { name: "Kaye Reyes", domainId: "AK47281" },
    ],
  },
];

const standbyTrip: RequestTrip = {
  mode: "standby",
  referenceId: "VR-1045",
  purpose: "Audit week — vehicle on call",
  details: "Van held on standby for the external auditors' site visits.",
  towerHead: "Ramon Diaz",
  window: "Mon, 17 Aug 2026 → Wed, 19 Aug 2026",
  hours: "6:00 AM – 6:00 PM",
  reportingPoint: "CGS Tower Manila lobby",
  passengers: [{ name: "Arielle Jimera", domainId: "AM65108" }],
};

const submittedMany: BookingSubmittedInput = {
  site: "Iloilo",
  rideMode: "Pickup / Drop-off",
  requestor: REQUESTOR,
  manageUrl: "http://localhost:3000/manage",
  trips,
};

const submittedOne: BookingSubmittedInput = {
  ...submittedMany,
  trips: [trips[0]],
};

const submittedStandby: BookingSubmittedInput = {
  ...submittedMany,
  site: "Manila",
  rideMode: "Standby",
  trips: [standbyTrip],
};

const adminNotice: AdminNewRequestInput = {
  site: "Iloilo",
  rideMode: "Pickup / Drop-off",
  requestor: REQUESTOR,
  adminUrl: "http://localhost:3000/dashboard",
  trips,
};

const adminNoticeManila: AdminNewRequestInput = {
  ...adminNotice,
  site: "Manila",
  rideMode: "Standby",
  trips: [standbyTrip],
};

const statusCommon = {
  site: "Iloilo",
  rideMode: "Pickup / Drop-off",
  requestor: REQUESTOR,
  manageUrl: "http://localhost:3000/manage",
  trips: [trips[0]],
};

const approved: BookingStatusChangeInput = {
  ...statusCommon,
  status: "Approved",
};

const rejected: BookingStatusChangeInput = {
  ...statusCommon,
  status: "Rejected",
  rejectionReason:
    "No van available on that date — please try the following week.",
};

const cancelledByRequestor: BookingStatusChangeInput = {
  ...statusCommon,
  status: "Cancelled",
  cancelledBy: "associate",
  cancellationReason: "Client meeting moved.",
};

const cancelledByAdmin: BookingStatusChangeInput = {
  ...cancelledByRequestor,
  cancelledBy: "admin_support",
  cancellationReason: "Cancelled by Admin Support — fleet maintenance.",
};

/** Two trips, two different vans — the case the driver cards exist for. */
const driverAssigned: DriverAssignmentInput = {
  ...statusCommon,
  change: "assigned",
  trips: [
    {
      ...trips[0],
      driver: {
        name: "Rico Santos",
        mobile: "0917 555 0100",
        plate: "ABC 1234",
      },
    },
    {
      ...trips[1],
      driver: {
        name: "Ana Villa",
        mobile: "0917 555 0200",
        plate: "XYZ 9876",
      },
    },
  ],
};

const driverChanged: DriverAssignmentInput = {
  ...driverAssigned,
  change: "changed",
};

export const PREVIEWS: Record<string, Preview> = {
  "booking-submitted": {
    title: "#1 Submitted — 3 trips (requestor)",
    to: REQUESTOR.email,
    cc: [],
    render: () => renderBookingSubmitted(submittedMany),
  },
  "booking-submitted-single": {
    title: "#1 Submitted — 1 trip (requestor)",
    to: REQUESTOR.email,
    cc: [],
    render: () => renderBookingSubmitted(submittedOne),
  },
  "booking-submitted-standby": {
    title: "#1 Submitted — standby window (requestor)",
    to: REQUESTOR.email,
    cc: [],
    // Manila, unlike the others — the standby fixture books the other site.
    render: () => renderBookingSubmitted(submittedStandby),
  },
  "admin-new-request": {
    title: "#2 New request (Iloilo admins)",
    to: ILOILO_ADMINS.join(", "),
    cc: [],
    render: () => renderAdminNewRequest(adminNotice),
  },
  "admin-new-request-manila": {
    // Same template, other site — the To line is what differs, and it is
    // resolved, not typed, so this is what Manila would really receive.
    title: "#2 New request (Manila admins, standby)",
    to: MANILA_ADMINS.join(", "),
    cc: [],
    render: () => renderAdminNewRequest(adminNoticeManila),
  },
  "status-approved": {
    title: "#3 Status — Approved (requestor, admins cc'd)",
    to: REQUESTOR.email,
    cc: ILOILO_ADMINS,
    render: () => renderBookingStatusChange(approved),
  },
  "status-rejected": {
    title: "#3 Status — Rejected (requestor, admins cc'd)",
    to: REQUESTOR.email,
    cc: ILOILO_ADMINS,
    render: () => renderBookingStatusChange(rejected),
  },
  "status-cancelled-by-requestor": {
    // Goes TO the admins: they had a #2 notice for a request now withdrawn.
    title: "#3 Status — Cancelled by requestor (to admins)",
    to: ILOILO_ADMINS.join(", "),
    cc: [],
    render: () => renderBookingStatusChange(cancelledByRequestor),
  },
  "status-cancelled-by-admin": {
    title: "#3 Status — Cancelled by Admin Support (to requestor)",
    to: REQUESTOR.email,
    cc: ILOILO_ADMINS,
    render: () => renderBookingStatusChange(cancelledByAdmin),
  },
  "driver-assigned": {
    title: "#4 Van assignment set (requestor)",
    to: REQUESTOR.email,
    cc: ILOILO_ADMINS,
    render: () => renderDriverAssignment(driverAssigned),
  },
  "driver-changed": {
    title: "#4 Van assignment changed (requestor)",
    to: REQUESTOR.email,
    cc: ILOILO_ADMINS,
    render: () => renderDriverAssignment(driverChanged),
  },
};
