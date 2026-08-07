import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  APP_TIME_ZONE,
  addPlainDays,
  comparePlainDates,
  comparePlainTimes,
  dayOfWeek,
  formatInstant,
  formatPlainDate,
  formatPlainDateTime,
  formatPlainMonth,
  formatPlainTime,
  instantFromManila,
  instantInManila,
  minutesSinceMidnight,
  monthOf,
  startOfWeek,
  todayInManila,
} from "@/lib/tz";

describe("formatPlainDate", () => {
  it.each([
    ["2026-08-05", "Aug 05 2026"],
    ["2026-01-01", "Jan 01 2026"],
    ["2026-12-31", "Dec 31 2026"],
    ["2024-02-29", "Feb 29 2024"],
  ])("formats %s as %s", (input, expected) => {
    expect(formatPlainDate(input)).toBe(expected);
  });

  // The whole reason this function never builds a Date. A plain calendar date
  // has no instant, so no runtime zone can move it — pinned by asserting the
  // day never shifts regardless of what TZ the test process runs under.
  it("is independent of the runtime timezone", () => {
    const original = process.env.TZ;
    const results: (string | null)[] = [];
    for (const tz of ["UTC", "Pacific/Auckland", "Pacific/Honolulu"]) {
      process.env.TZ = tz;
      results.push(formatPlainDate("2026-08-05"));
    }
    process.env.TZ = original;
    expect(new Set(results)).toEqual(new Set(["Aug 05 2026"]));
  });

  it.each([
    ["impossible month", "2026-13-01"],
    ["zero month", "2026-00-10"],
    ["day past month end", "2026-02-30"],
    ["day past 30 in a 30-day month", "2026-04-31"],
    ["Feb 29 in a common year", "2026-02-29"],
    ["Feb 29 in a century non-leap year", "1900-02-29"],
    ["zero day", "2026-08-00"],
    ["single-digit month", "2026-8-05"],
    ["slashes", "2026/08/05"],
    ["an instant, not a plain date", "2026-08-05T00:00:00Z"],
    ["trailing space", "2026-08-05 "],
    ["empty", ""],
  ])("refuses %s", (_label, input) => {
    expect(formatPlainDate(input)).toBeNull();
  });

  it("accepts Feb 29 in a 400-divisible century year", () => {
    expect(formatPlainDate("2000-02-29")).toBe("Feb 29 2000");
  });

  it.each([null, undefined])("refuses %s", (input) => {
    expect(formatPlainDate(input)).toBeNull();
  });
});

describe("formatPlainTime", () => {
  it.each([
    ["09:14", "9:14 AM"],
    ["00:00", "12:00 AM"],
    ["12:00", "12:00 PM"],
    ["12:59", "12:59 PM"],
    ["13:05", "1:05 PM"],
    ["23:59", "11:59 PM"],
    ["09:14:30", "9:14 AM"],
  ])("formats %s as %s", (input, expected) => {
    expect(formatPlainTime(input)).toBe(expected);
  });

  it.each([
    ["hour 24", "24:00"],
    ["hour past 24", "25:00"],
    ["minute past 59", "10:60"],
    ["single-digit hour", "9:14"],
    ["no minutes", "09"],
    ["empty", ""],
  ])("refuses %s", (_label, input) => {
    expect(formatPlainTime(input)).toBeNull();
  });
});

describe("formatPlainDateTime", () => {
  it("joins both halves with the design's separator", () => {
    expect(formatPlainDateTime("2026-08-05", "09:14")).toBe(
      "Aug 05 2026 · 9:14 AM",
    );
  });

  // Half a formatted value is worse than none — it reads as complete.
  it.each([
    ["2026-08-05", ""],
    ["", "09:14"],
    ["2026-02-30", "09:14"],
  ])("refuses the pair (%s, %s) rather than formatting half", (d, t) => {
    expect(formatPlainDateTime(d, t)).toBeNull();
  });
});

describe("formatInstant", () => {
  it("renders an instant in Asia/Manila, not the runtime zone", () => {
    // 2026-08-05T01:14Z is 09:14 in Manila (UTC+8).
    expect(formatInstant(new Date("2026-08-05T01:14:00Z"))).toBe(
      "Aug 05 2026, 9:14 AM PHT",
    );
  });

  it("rolls the date forward when Manila is a day ahead of UTC", () => {
    // 23:30Z on the 4th is 07:30 on the 5th in Manila. A formatter that
    // forgot the zone would report the 4th.
    expect(formatInstant(new Date("2026-08-04T23:30:00Z"))).toBe(
      "Aug 05 2026, 7:30 AM PHT",
    );
  });

  it("is independent of the runtime timezone", () => {
    const original = process.env.TZ;
    const results: (string | null)[] = [];
    for (const tz of ["UTC", "Pacific/Auckland", "America/New_York"]) {
      process.env.TZ = tz;
      results.push(formatInstant(new Date("2026-08-05T01:14:00Z")));
    }
    process.env.TZ = original;
    expect(new Set(results)).toEqual(new Set(["Aug 05 2026, 9:14 AM PHT"]));
  });

  it("refuses an invalid Date rather than rendering 'Invalid Date'", () => {
    expect(formatInstant(new Date("nonsense"))).toBeNull();
  });

  it("names the application timezone explicitly", () => {
    expect(APP_TIME_ZONE).toBe("Asia/Manila");
  });
});

describe("todayInManila", () => {
  it("returns a plain date in the format the comparators accept", () => {
    expect(todayInManila(new Date("2026-08-05T04:00:00Z"))).toBe("2026-08-05");
    expect(comparePlainDates(todayInManila(new Date()), "2026-01-01")).not.toBe(
      null,
    );
  });

  // Manila is UTC+8, so between 16:00Z and 24:00Z it is already tomorrow there.
  // A version that used the runtime's date would report the 4th for both of
  // these on a UTC server, and every same-day booking would land in Past Trips.
  it.each([
    ["just before Manila midnight", "2026-08-04T15:59:00Z", "2026-08-04"],
    ["just after Manila midnight", "2026-08-04T16:00:00Z", "2026-08-05"],
    ["late UTC evening", "2026-08-04T23:30:00Z", "2026-08-05"],
  ])("resolves %s to %s", (_label, instant, expected) => {
    expect(todayInManila(new Date(instant))).toBe(expected);
  });

  it("is independent of the runtime timezone", () => {
    const original = process.env.TZ;
    const results: string[] = [];
    for (const tz of ["UTC", "Pacific/Auckland", "America/New_York"]) {
      process.env.TZ = tz;
      results.push(todayInManila(new Date("2026-08-04T23:30:00Z")));
    }
    process.env.TZ = original;
    expect(new Set(results)).toEqual(new Set(["2026-08-05"]));
  });

  it("zero-pads single-digit months and days", () => {
    // "2026-1-5" would break every lexicographic comparison in manage-filters.
    expect(todayInManila(new Date("2026-01-05T04:00:00Z"))).toBe("2026-01-05");
  });
});

describe("comparePlainDates", () => {
  it.each([
    ["2026-08-05", "2026-08-06", -1],
    ["2026-08-06", "2026-08-05", 1],
    ["2026-08-05", "2026-08-05", 0],
    ["2026-08-31", "2026-09-01", -1],
    ["2026-12-31", "2027-01-01", -1],
  ])("compares %s to %s as %i", (a, b, expected) => {
    expect(comparePlainDates(a, b)).toBe(expected);
  });

  // Returning 0 for garbage would read as "same day" and let an invalid range
  // through validation.
  it.each([
    ["", "2026-08-05"],
    ["2026-08-05", "2026-02-30"],
    ["not-a-date", "also-not"],
  ])("returns null rather than 0 for the invalid pair (%s, %s)", (a, b) => {
    expect(comparePlainDates(a, b)).toBeNull();
  });
});

describe("comparePlainTimes", () => {
  it.each([
    ["09:00", "17:00", true],
    ["17:00", "09:00", false],
  ])("orders %s before %s: %s", (a, b, earlier) => {
    const result = comparePlainTimes(a, b);
    expect(result === null ? null : result < 0).toBe(earlier);
  });

  it("treats equal times as equal", () => {
    expect(comparePlainTimes("09:00", "09:00")).toBe(0);
  });

  it("returns null for an unparseable side", () => {
    expect(comparePlainTimes("9:00", "17:00")).toBeNull();
  });
});

// ── drift guard ──────────────────────────────────────────────────────────────
// Every locale-formatting API silently uses the runtime's timezone. One call in
// a component is enough to reintroduce server/client hydration mismatches for
// eight hours a day, and it would look completely correct to whoever wrote it.
// This is the enforcement half of tz.ts's file comment; without it that comment
// is a suggestion.
describe("date formatting stays inside lib/tz.ts", () => {
  // Matched as CALLS, not as bare names. An earlier version used
  // `source.includes("toLocaleDateString")` and immediately failed on
  // `step-review.tsx`, whose doc comment explains that it must not use it —
  // the guard flagged its own documentation. A rule that fires on prose is a
  // rule someone deletes, so requiring the opening paren lets a comment name
  // the API while still catching every real invocation.
  const FORBIDDEN = [
    /\.toLocaleDateString\s*\(/,
    /\.toLocaleTimeString\s*\(/,
    /\.toLocaleString\s*\(/,
    /\bIntl\s*\.\s*DateTimeFormat\s*\(/,
  ];

  function sourceFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return sourceFiles(path);
      return /\.tsx?$/.test(entry.name) ? [path] : [];
    });
  }

  it("finds no locale-formatting calls anywhere else in src/", () => {
    const offenders: string[] = [];

    for (const file of sourceFiles("src")) {
      // tz.ts is the sanctioned home; its own test names the APIs in this list.
      if (file === join("src", "lib", "tz.ts")) continue;
      if (file === join("src", "lib", "tz.test.ts")) continue;

      const source = readFileSync(file, "utf8");
      for (const api of FORBIDDEN) {
        if (api.test(source)) offenders.push(`${file} matches ${api.source}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  // A guard that cannot fail is decoration. These prove the pattern set both
  // catches real calls and tolerates prose, which is the balance that decides
  // whether the guard survives its first false positive.
  it.each([
    "const s = value.toLocaleDateString('en-PH');",
    "const s = value.toLocaleTimeString();",
    "const s = d.toLocaleString('en-PH');",
    "const f = new Intl.DateTimeFormat('en-PH', {});",
    "const f = new Intl . DateTimeFormat('en-PH');",
  ])("catches %s", (sample) => {
    expect(FORBIDDEN.some((api) => api.test(sample))).toBe(true);
  });

  it.each([
    "// never reach for toLocaleDateString here",
    "/** enforced so this file cannot use Intl.DateTimeFormat */",
    "* sees the wrong day — see toLocaleString's zone behaviour",
  ])("tolerates the prose %s", (sample) => {
    expect(FORBIDDEN.some((api) => api.test(sample))).toBe(false);
  });

  it("scans a non-trivial number of files", () => {
    // If the walk silently returned [] the guard above would pass vacuously.
    expect(sourceFiles("src").length).toBeGreaterThan(30);
  });
});

describe("formatPlainMonth", () => {
  it.each([
    ["2026-08", "Aug 2026"],
    ["2026-01", "Jan 2026"],
    ["2026-12", "Dec 2026"],
  ])("renders %s as %s", (value, expected) => {
    expect(formatPlainMonth(value)).toBe(expected);
  });

  it.each(["2026-13", "2026-00", "2026-8", "2026", "2026-08-05", "", null])(
    "refuses %s",
    (value) => {
      expect(formatPlainMonth(value)).toBeNull();
    },
  );
});

describe("monthOf", () => {
  it("extracts the month a plain date falls in", () => {
    expect(monthOf("2026-08-05")).toBe("2026-08");
    expect(monthOf("2026-01-31")).toBe("2026-01");
  });

  it("refuses a date it would not accept elsewhere", () => {
    expect(monthOf("2026-02-30")).toBeNull();
    expect(monthOf("not a date")).toBeNull();
  });
});

describe("minutesSinceMidnight", () => {
  it.each([
    ["00:00", 0],
    ["06:30", 390],
    ["12:00", 720],
    ["23:59", 1439],
  ])("converts %s to %i", (value, expected) => {
    expect(minutesSinceMidnight(value)).toBe(expected);
  });

  it("refuses an impossible time", () => {
    expect(minutesSinceMidnight("24:00")).toBeNull();
    expect(minutesSinceMidnight("10:60")).toBeNull();
  });
});

describe("dayOfWeek", () => {
  // Monday-based. The anchor is 1970-01-01, a Thursday — if the offset were
  // wrong every calendar column would be shifted by the same amount, which is
  // the kind of bug that looks plausible on screen.
  it.each([
    ["1970-01-01", 3],
    ["2026-08-03", 0],
    ["2026-08-04", 1],
    ["2026-08-05", 2],
    ["2026-08-06", 3],
    ["2026-08-07", 4],
    ["2026-08-08", 5],
    ["2026-08-09", 6],
  ])("puts %s at index %i", (value, expected) => {
    expect(dayOfWeek(value)).toBe(expected);
  });

  it("agrees with the runtime's own calendar across a long span", () => {
    // Cross-checked against Date in UTC — not used in the implementation,
    // which must stay zone-free, but a second opinion on 400 years of leap
    // rules is worth having.
    for (let offset = 0; offset < 400; offset += 7) {
      const utc = new Date(Date.UTC(2026, 0, 1 + offset * 3));
      const iso = utc.toISOString().slice(0, 10);
      // Date's getUTCDay is Sunday-based; shift it to Monday-based.
      expect(dayOfWeek(iso)).toBe((utc.getUTCDay() + 6) % 7);
    }
  });

  it("refuses a malformed date", () => {
    expect(dayOfWeek("2026-02-30")).toBeNull();
  });
});

describe("addPlainDays", () => {
  it.each([
    ["2026-08-05", 1, "2026-08-06"],
    ["2026-08-05", -1, "2026-08-04"],
    ["2026-08-05", 0, "2026-08-05"],
    ["2026-08-31", 1, "2026-09-01"],
    ["2026-12-31", 1, "2027-01-01"],
    ["2026-01-01", -1, "2025-12-31"],
    ["2026-08-05", 7, "2026-08-12"],
    ["2026-08-05", -7, "2026-07-29"],
  ])("adds %i days to %s giving %s", (value, days, expected) => {
    expect(addPlainDays(value, days)).toBe(expected);
  });

  // Leap years are where naive day arithmetic breaks, and 2100 is where the
  // "divisible by four" shortcut breaks.
  it.each([
    ["2024-02-28", 1, "2024-02-29"],
    ["2024-02-29", 1, "2024-03-01"],
    ["2025-02-28", 1, "2025-03-01"],
    ["2100-02-28", 1, "2100-03-01"],
    ["2000-02-28", 1, "2000-02-29"],
  ])("handles the leap boundary %s + %i = %s", (value, days, expected) => {
    expect(addPlainDays(value, days)).toBe(expected);
  });

  it("round-trips", () => {
    expect(addPlainDays(addPlainDays("2026-08-05", 365) ?? "", -365)).toBe(
      "2026-08-05",
    );
  });

  it("refuses a malformed date", () => {
    expect(addPlainDays("2026-13-01", 1)).toBeNull();
  });
});

describe("startOfWeek", () => {
  it("returns the Monday of the containing week", () => {
    // Aug 3 2026 is a Monday; every day of that week resolves to it.
    for (let offset = 0; offset < 7; offset += 1) {
      const day = addPlainDays("2026-08-03", offset) ?? "";
      expect(startOfWeek(day)).toBe("2026-08-03");
    }
  });

  it("is idempotent on a Monday", () => {
    expect(startOfWeek("2026-08-03")).toBe("2026-08-03");
  });

  it("crosses a month boundary backwards", () => {
    // Sep 1 2026 is a Tuesday, so its week starts in August.
    expect(startOfWeek("2026-09-01")).toBe("2026-08-31");
  });

  it("refuses a malformed date", () => {
    expect(startOfWeek("nope")).toBeNull();
  });
});

describe("instantInManila", () => {
  it("converts a UTC instant to Manila date and time", () => {
    expect(instantInManila(new Date("2026-08-07T22:30:00Z"))).toEqual({
      date: "2026-08-08",
      time: "06:30",
    });
  });

  it("renders Manila midnight as 00:00, not 24:00", () => {
    expect(instantInManila(new Date("2026-08-07T16:00:00Z"))).toEqual({
      date: "2026-08-08",
      time: "00:00",
    });
  });

  it("returns null for an invalid Date", () => {
    expect(instantInManila(new Date("nonsense"))).toBeNull();
  });
});

describe("instantFromManila", () => {
  it("converts Manila wall-clock to the UTC instant", () => {
    expect(instantFromManila("2026-08-08", "06:30")?.toISOString()).toBe(
      "2026-08-07T22:30:00.000Z",
    );
  });

  it("round-trips with instantInManila", () => {
    const instant = instantFromManila("2026-02-28", "23:45");
    expect(instant).not.toBeNull();
    expect(instantInManila(instant as Date)).toEqual({
      date: "2026-02-28",
      time: "23:45",
    });
  });

  it("returns null for malformed inputs", () => {
    expect(instantFromManila("2026-13-01", "06:30")).toBeNull();
    expect(instantFromManila("2026-08-08", "24:00")).toBeNull();
  });
});
