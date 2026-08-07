/**
 * The ONLY place in this codebase permitted to format a date or a time.
 *
 * `tz.test.ts` enforces that with a drift guard that scans `src/` for
 * `toLocaleDateString`, `toLocaleTimeString`, `toLocaleString` and
 * `Intl.DateTimeFormat` outside this file. The reason is that every one of those
 * silently uses the RUNTIME's timezone and locale: on a server in UTC and a
 * laptop in Asia/Manila they produce different strings for the same value, and
 * in Next that means server-rendered markup disagreeing with the client's
 * hydration for eight hours out of every twenty-four.
 *
 * ── The distinction that actually matters ────────────────────────────────────
 *
 * This module deliberately splits two things most date utilities conflate:
 *
 * **Plain values** — what `<input type="date">` and `<input type="time">`
 * produce: `"2026-08-05"` and `"09:14"`. These are calendar dates and wall-clock
 * times. They carry NO instant and NO zone: "the 5th of August" is the 5th of
 * August regardless of where you read it. They are formatted by taking the
 * string apart, never by constructing a `Date`.
 *
 * That is not fussiness. `new Date("2026-08-05T00:00")` parses as midnight in
 * the RUNTIME's zone; render that through Asia/Manila from a machine set to
 * Pacific/Auckland (UTC+13) and you get the 4th of August. A user in Manila
 * picks the 5th, the confirmation says the 4th, and the bug reproduces for
 * nobody on the team. Keeping plain values as strings makes it unrepresentable.
 *
 * **Instants** — a real moment, e.g. a `timestamptz` column. Those DO need a
 * zone to render, and they get Asia/Manila explicitly.
 */

/** Asia/Manila is UTC+08:00 and has observed no DST since 1978. */
export const APP_TIME_ZONE = "Asia/Manila";

/** Placeholder for an absent value. Callers apply it; formatters return null. */
export const EM_DASH = "—";

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/**
 * `"2026-08-05"` → `"Aug 05 2026"`.
 *
 * Returns null for anything that is not a well-formed calendar date, including
 * a real-looking string with an impossible month or day (`"2026-13-01"`,
 * `"2026-02-30"`). Callers pair it with `EM_DASH`.
 */
export function formatPlainDate(
  value: string | null | undefined,
): string | null {
  const parts = parsePlainDate(value);
  if (parts === null) return null;
  const { year, month, day } = parts;
  return `${MONTHS[month - 1]} ${String(day).padStart(2, "0")} ${year}`;
}

/**
 * `"2026-08"` → `"Aug 2026"`.
 *
 * A calendar month, which is a plain value like a date: "August 2026" names the
 * same month everywhere. Returns null for a malformed month or one outside
 * 01–12, so a caller cannot render "Aug 2026" for `"2026-13"`.
 */
export function formatPlainMonth(
  value: string | null | undefined,
): string | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (match === null) return null;

  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return `${MONTHS[month - 1]} ${match[1]}`;
}

/** The `"YYYY-MM"` a plain date falls in, or null if the date is malformed. */
export function monthOf(value: string | null | undefined): string | null {
  const parts = parsePlainDate(value);
  if (parts === null) return null;
  return `${parts.year}-${String(parts.month).padStart(2, "0")}`;
}

/**
 * `"09:14"` → `"9:14 AM"`. Accepts `"HH:mm"` and `"HH:mm:ss"`.
 *
 * Midnight formats as `12:00 AM` and noon as `12:00 PM` — the two cases a naive
 * `h % 12` gets wrong by rendering `0:00`.
 */
export function formatPlainTime(
  value: string | null | undefined,
): string | null {
  const parts = parsePlainTime(value);
  if (parts === null) return null;
  const { hour, minute } = parts;
  const meridiem = hour < 12 ? "AM" : "PM";
  const displayHour = hour % 12 === 0 ? 12 : hour % 12;
  return `${displayHour}:${String(minute).padStart(2, "0")} ${meridiem}`;
}

/** `("2026-08-05", "09:14")` → `"Aug 05 2026 · 9:14 AM"`, or null if either half is invalid. */
export function formatPlainDateTime(
  date: string | null | undefined,
  time: string | null | undefined,
): string | null {
  const d = formatPlainDate(date);
  const t = formatPlainTime(time);
  if (d === null || t === null) return null;
  return `${d} · ${t}`;
}

/**
 * A real instant → `"Aug 05 2026, 9:14 AM PHT"`, always in Asia/Manila.
 *
 * `en-PH` is pinned rather than using the runtime default, so the output cannot
 * drift with the host's locale. "PHT" is appended as a literal because
 * `timeZoneName: "short"` renders it as "GMT+8" in most ICU builds, which is
 * accurate but not what the design shows.
 */
export function formatInstant(value: Date): string | null {
  if (Number.isNaN(value.getTime())) return null;

  const parts = new Intl.DateTimeFormat("en-PH", {
    timeZone: APP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(value);

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";

  // Reassembled through the plain formatters above so an instant and a plain
  // value can never render in two different shapes.
  const date = formatPlainDate(`${get("year")}-${get("month")}-${get("day")}`);
  const time = formatPlainTime(`${get("hour")}:${get("minute")}`);
  if (date === null || time === null) return null;

  return `${date}, ${time} PHT`;
}

/**
 * Today's calendar date in Asia/Manila, as a plain `YYYY-MM-DD`.
 *
 * Needed to decide whether a booking is upcoming or past. "Today" is the one
 * plain value that has to be derived from an instant, so it is derived HERE and
 * nowhere else.
 *
 * Callers should compute this on the server and pass it down rather than calling
 * it during render on both sides: server and client evaluate at slightly
 * different instants, and a page rendered either side of Manila midnight would
 * hydrate with two different answers and silently reclassify a row.
 */
export function todayInManila(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";

  return `${get("year")}-${get("month")}-${get("day")}`;
}

/**
 * A real instant → the Manila calendar date and wall-clock time it lands on.
 * The repo boundary uses this to turn a `timestamptz` into the plain
 * `startDate`/`startTime` strings the wire types carry (see `types.ts`).
 */
export function instantInManila(
  value: Date,
): { date: string; time: string } | null {
  if (Number.isNaN(value.getTime())) return null;

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    // h23, not hour12:false — some ICU builds render midnight as "24" without it.
    hourCycle: "h23",
  }).formatToParts(value);

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";

  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${get("hour")}:${get("minute")}`,
  };
}

/**
 * Manila wall-clock → the instant it names. The inverse of `instantInManila`,
 * used when a plain date + time pair (a fixture, a form value) must become a
 * `timestamptz`. Fixed arithmetic is safe: Manila is UTC+08:00 with no DST
 * since 1978 (see APP_TIME_ZONE above).
 */
export function instantFromManila(date: string, time: string): Date | null {
  const d = parsePlainDate(date);
  const t = parsePlainTime(time);
  if (d === null || t === null) return null;

  const days = daysFromCivil(d.year, d.month, d.day);
  const utcMs =
    (days * 86_400 + (t.hour * 60 + t.minute) * 60 - 8 * 3_600) * 1_000;
  return new Date(utcMs);
}

/**
 * Chronological comparison of two plain dates, safe because ISO `YYYY-MM-DD`
 * sorts lexicographically. Exported so validation never reaches for `Date` to
 * answer "is the end before the start?".
 *
 * Returns null if either side is not a valid plain date, so a caller cannot
 * mistake "unparseable" for "in order".
 */
export function comparePlainDates(a: string, b: string): number | null {
  if (parsePlainDate(a) === null || parsePlainDate(b) === null) return null;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Same, for `"HH:mm"` wall-clock times, which also sort lexicographically. */
export function comparePlainTimes(a: string, b: string): number | null {
  const pa = parsePlainTime(a);
  const pb = parsePlainTime(b);
  if (pa === null || pb === null) return null;
  const minsA = pa.hour * 60 + pa.minute;
  const minsB = pb.hour * 60 + pb.minute;
  return minsA - minsB;
}

/**
 * Day of the week for a plain date: 0 = Monday … 6 = Sunday. Null if the date
 * is malformed.
 *
 * Monday-based because the admin calendar's week runs Mon–Sun, and converting a
 * Sunday-based index at every call site is how one view ends up off by a day.
 */
export function dayOfWeek(value: string): number | null {
  const parts = parsePlainDate(value);
  if (parts === null) return null;
  // 1970-01-01 was a Thursday, which is index 3 in a Monday-based week.
  const days = daysFromCivil(parts.year, parts.month, parts.day);
  return (((days + 3) % 7) + 7) % 7;
}

/** `addPlainDays("2026-08-31", 1)` → `"2026-09-01"`. Null if malformed. */
export function addPlainDays(value: string, days: number): string | null {
  const parts = parsePlainDate(value);
  if (parts === null) return null;
  const { year, month, day } = civilFromDays(
    daysFromCivil(parts.year, parts.month, parts.day) + days,
  );
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** The Monday of the week containing a plain date. Null if malformed. */
export function startOfWeek(value: string): string | null {
  const index = dayOfWeek(value);
  if (index === null) return null;
  return addPlainDays(value, -index);
}

/** Minutes since midnight for a `"HH:mm"` wall-clock time. Null if malformed. */
export function minutesSinceMidnight(value: string): number | null {
  const parts = parsePlainTime(value);
  if (parts === null) return null;
  return parts.hour * 60 + parts.minute;
}

/**
 * Days between 1970-01-01 and a proleptic Gregorian date, and back.
 *
 * Howard Hinnant's `days_from_civil` / `civil_from_days`, which are exact
 * integer arithmetic over the whole representable range. Deliberately not
 * `new Date(y, m, d)`: that constructor interprets its arguments in the
 * RUNTIME's timezone, so adding a day to a plain date through it can land on
 * the same day, or two days later, depending on where the process runs and
 * whether it crossed a DST boundary. This whole file exists to keep zones out
 * of plain-value handling.
 */
function daysFromCivil(year: number, month: number, day: number): number {
  const y = year - (month <= 2 ? 1 : 0);
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy =
    Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

function civilFromDays(input: number): PlainDateParts {
  const z = input + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor(
    (doe -
      Math.floor(doe / 1460) +
      Math.floor(doe / 36524) -
      Math.floor(doe / 146096)) /
      365,
  );
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp + (mp < 10 ? 3 : -9);
  return { year: y + (month <= 2 ? 1 : 0), month, day };
}

interface PlainDateParts {
  year: number;
  month: number;
  day: number;
}

function parsePlainDate(
  value: string | null | undefined,
): PlainDateParts | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;

  return { year, month, day };
}

function parsePlainTime(
  value: string | null | undefined,
): { hour: number; minute: number } | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{2}):(\d{2})(?::\d{2})?$/.exec(value);
  if (match === null) return null;

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  // 24:00 is legal ISO 8601 but no `<input type="time">` emits it, and treating
  // it as valid would let it compare as later than 23:59 while formatting as
  // "12:00 PM". Refused rather than special-cased.
  if (hour > 23 || minute > 59) return null;

  return { hour, minute };
}

function daysInMonth(year: number, month: number): number {
  // Deliberately arithmetic, not `new Date(year, month, 0).getDate()` — that
  // constructor is zone-sensitive and this file exists to keep zones out of
  // plain-value handling.
  if (month === 2) {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return leap ? 29 : 28;
  }
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}
