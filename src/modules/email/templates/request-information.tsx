import { Section, Text } from "@react-email/components";
import { styles } from "@/modules/email/templates/styles";

/**
 * The "Request Information" block every notification carries: the booking as a
 * stack of cards, mirroring step 4 of the wizard (`step-review.tsx`). A
 * requestor who reviewed their request before submitting should recognise the
 * email as the same thing, in the same order.
 *
 * Every value is a PRE-FORMATTED display string. Dates and times are formatted
 * by the caller with `lib/tz.ts` helpers, never here — an email has no timezone,
 * and a `timestamptz` rendered in the wrong one shows the wrong day. This is the
 * same contract each template takes, and `tz.test.ts`'s drift guard enforces the
 * half of it that can be enforced.
 */

export interface RequestPassenger {
  name: string;
  /** 7-character Domain ID, shown in parentheses after the name. */
  domainId: string;
}

/**
 * The van and who drives it, when one has been assigned.
 *
 * Per TRIP, not per submission: a three-date standby block can be covered by
 * three different drivers. And `plate` sits here rather than beside the driver's
 * name for the same reason — a driver may take a different unit on a different
 * day, so the plate belongs to the assignment, not to the person.
 */
export interface RequestDriver {
  name: string;
  mobile: string;
  plate: string;
  /**
   * Optional so an outbox row queued before this field existed still renders
   * — see `templates/index.ts`'s `driver` schema. A plate alone does not tell
   * a requestor whether to expect a sedan or a Hi Ace; naming the vehicle
   * does.
   */
  carType?: string;
}

interface TripCommon {
  /** This trip's own reservation reference — one per trip, not per submission. */
  referenceId: string;
  purpose: string;
  details: string;
  passengers: RequestPassenger[];
  /** Absent until Admin Support assigns one. Only shown when present. */
  driver?: RequestDriver;
}

/**
 * A trip, discriminated by ride mode.
 *
 * A union rather than one interface with everything optional, because the two
 * modes genuinely describe different things: a standby block has a window and a
 * reporting point and no drop-off, and rendering it through pickup labels was
 * how the earlier single-trip template would have shown "Pickup time: 6:00 AM –
 * 6:00 PM". The branch lives HERE, once, so the three templates never repeat it.
 */
export type RequestTrip = TripCommon &
  (
    | {
        mode: "pickup";
        /** Date and time as one string — see `formatPlainDateTime`. */
        pickup: string;
        pickupPoint: string;
        dropoffPoint: string;
      }
    | {
        mode: "standby";
        towerHead: string;
        /** "Mon, 17 Aug 2026 → Wed, 19 Aug 2026" */
        window: string;
        /** "6:00 AM – 6:00 PM" */
        hours: string;
        reportingPoint: string;
      }
  );

export interface RequestInformationInput {
  site: string;
  rideMode: string;
  requestor: {
    name: string;
    email: string;
    mobile: string;
  };
  /** At least one. Each is its own reservation row with its own reference. */
  trips: RequestTrip[];
}

const card = {
  wrapper: {
    border: "1px solid #eeeeee",
    borderRadius: "12px",
    padding: "20px 22px",
    margin: "0 0 14px",
  },
  title: {
    fontSize: "15px",
    fontWeight: 600,
    color: "#2b1b49",
    margin: "0 0 2px",
  },
  reference: {
    fontSize: "12px",
    color: "#949494",
    letterSpacing: "0.04em",
    margin: "0 0 16px",
  },
  passengers: {
    fontSize: "13px",
    lineHeight: "20px",
    color: "#666666",
    margin: "4px 0 0",
    paddingTop: "12px",
    borderTop: "1px solid #f5f5f5",
  },
  driverBlock: {
    backgroundColor: "#faf9fc",
    borderRadius: "8px",
    padding: "12px 14px",
    margin: "0 0 4px",
  },
  driverLabel: {
    fontSize: "11px",
    fontWeight: 600,
    color: "#5009b5",
    textTransform: "uppercase" as const,
    letterSpacing: "0.06em",
    margin: "0 0 8px",
  },
  driverRow: {
    fontSize: "13px",
    lineHeight: "20px",
    color: "#231e33",
    margin: "0",
  },
} as const;

function Row({ label, value }: { label: string; value: string }) {
  return (
    <Section>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </Section>
  );
}

function Card({
  title,
  reference,
  children,
  footer,
}: {
  title: string;
  reference?: string;
  children: React.ReactNode;
  footer?: string;
}) {
  return (
    <Section style={card.wrapper}>
      <Text style={card.title}>{title}</Text>
      {reference !== undefined && (
        <Text style={card.reference}>{reference}</Text>
      )}
      {children}
      {footer !== undefined && <Text style={card.passengers}>{footer}</Text>}
    </Section>
  );
}

/**
 * "2 passengers: Juan Cruz (AB12345) · Maria Reyes (AC67890)" — the same
 * summary line step 4 renders, so the two read identically.
 */
function passengerSummary(passengers: RequestPassenger[]): string {
  const count = passengers.length;
  const listed = passengers.map((p) => `${p.name} (${p.domainId})`).join(" · ");
  return `${count} passenger${count === 1 ? "" : "s"}: ${listed}`;
}

/**
 * The assigned van, inside the trip card it belongs to. Rendered only when a
 * driver exists, so the same card serves a pending request and an assigned one.
 */
function Driver({ driver }: { driver: RequestDriver }) {
  return (
    <Section style={card.driverBlock}>
      <Text style={card.driverLabel}>Assigned van</Text>
      <Text style={card.driverRow}>
        <strong>{driver.name}</strong>
      </Text>
      <Text style={card.driverRow}>{driver.mobile}</Text>
      <Text style={card.driverRow}>Plate {driver.plate}</Text>
      {driver.carType !== undefined && (
        <Text style={card.driverRow}>{driver.carType}</Text>
      )}
    </Section>
  );
}

function TripCard({ trip, index }: { trip: RequestTrip; index: number }) {
  const standby = trip.mode === "standby";
  return (
    <Card
      // "Date N" for standby: the wizard calls them dates there, and a standby
      // block is a day the van is held, not a journey.
      title={`${standby ? "Date" : "Trip"} ${index + 1}`}
      reference={trip.referenceId}
      footer={passengerSummary(trip.passengers)}
    >
      <Row label="Purpose" value={trip.purpose} />
      <Row label="Details" value={trip.details} />
      {trip.mode === "pickup" ? (
        <>
          <Row label="Pickup" value={trip.pickup} />
          <Row label="Pickup Point" value={trip.pickupPoint} />
          <Row label="Drop-off Point" value={trip.dropoffPoint} />
        </>
      ) : (
        <>
          <Row label="Approving Tower Head" value={trip.towerHead} />
          <Row label="Standby Window" value={trip.window} />
          <Row label="Reporting Point" value={trip.reportingPoint} />
          <Row label="Hours" value={trip.hours} />
        </>
      )}
      {trip.driver !== undefined && <Driver driver={trip.driver} />}
    </Card>
  );
}

export function RequestInformation({
  site,
  rideMode,
  requestor,
  trips,
}: RequestInformationInput) {
  return (
    <Section>
      <Card title="Ride &amp; Site">
        <Row label="Site Location" value={site} />
        <Row label="Ride Type" value={rideMode} />
      </Card>

      <Card title="Requestor">
        <Row label="Name" value={requestor.name} />
        <Row label="Email" value={requestor.email} />
        <Row label="Mobile Number" value={requestor.mobile} />
      </Card>

      {trips.map((trip, index) => (
        <TripCard key={trip.referenceId} trip={trip} index={index} />
      ))}
    </Section>
  );
}
