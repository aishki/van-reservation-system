import { describe, expect, it } from "vitest";
import { formatPlainTime } from "@/lib/tz";
import { ALL } from "@/modules/reservations/admin-filters";
import {
  EXPORT_COLUMNS,
  escapeCsvCell,
  reportFileName,
  reservationCsv,
  toCsv,
} from "@/modules/reservations/export";
import { sampleAdminRequests } from "@/test-fixtures/reservations";

describe("escapeCsvCell", () => {
  it("leaves an ordinary value alone", () => {
    expect(escapeCsvCell("Manila")).toBe("Manila");
    expect(escapeCsvCell("REQ-1051")).toBe("REQ-1051");
  });

  it.each([
    ["a comma", "GLS Tower, Lobby 2", '"GLS Tower, Lobby 2"'],
    ["a quote", 'the "north" gate', '"the ""north"" gate"'],
    ["a newline", "line one\nline two", '"line one\nline two"'],
    ["a carriage return", "a\rb", '"a\rb"'],
  ])("quotes a value containing %s", (_label, input, expected) => {
    expect(escapeCsvCell(input)).toBe(expected);
  });

  // A cell starting with any of these is evaluated as a formula by Excel and
  // Sheets. The pickup point is free text a requestor typed, so this is a real
  // path from user input to code running on an admin's machine.
  it.each(["=1+1", '=HYPERLINK("http://x")', "+1", "-1", "@SUM(A1)", "\tx"])(
    "neutralises the formula %j",
    (input) => {
      // Stripped of any CSV wrapping quote, the payload must begin with the
      // apostrophe guard. `=HYPERLINK("…")` gets both treatments — it contains
      // a quote, so the guard ends up inside the quoted section.
      expect(escapeCsvCell(input).replace(/^"/, "").startsWith("'")).toBe(true);
    },
  );

  it("neutralises a formula and still quotes it when it needs quoting", () => {
    expect(escapeCsvCell("=A1,B2")).toBe('"\'=A1,B2"');
  });

  it("does not treat a minus inside a value as a formula", () => {
    // Only the FIRST character matters — over-guarding would put an apostrophe
    // into every reference number.
    expect(escapeCsvCell("REQ-1051")).toBe("REQ-1051");
    expect(escapeCsvCell("6:30 AM – 7:30 AM")).toBe("6:30 AM – 7:30 AM");
  });

  it("leaves an empty value empty", () => {
    expect(escapeCsvCell("")).toBe("");
  });
});

describe("toCsv", () => {
  it("joins cells with commas and rows with CRLF", () => {
    expect(
      toCsv([
        ["a", "b"],
        ["c", "d"],
      ]),
    ).toBe("a,b\r\nc,d");
  });

  it("renders an empty document for no rows", () => {
    expect(toCsv([])).toBe("");
  });

  it("keeps a quoted cell's comma inside its own column", () => {
    const csv = toCsv([["one", "two, three", "four"]]);
    expect(csv).toBe('one,"two, three",four');
  });
});

describe("reservationCsv", () => {
  const rows = sampleAdminRequests();

  it("starts with the header row", () => {
    expect(reservationCsv(rows).split("\r\n")[0]).toBe(
      EXPORT_COLUMNS.join(","),
    );
  });

  it("writes one line per reservation plus the header", () => {
    expect(reservationCsv(rows).split("\r\n")).toHaveLength(rows.length + 1);
  });

  it("gives every line the same number of columns", () => {
    // A row with a different column count is a shifted spreadsheet, which is
    // the failure the quoting rules exist to prevent.
    for (const line of reservationCsv(rows).split("\r\n")) {
      expect(countColumns(line)).toBe(EXPORT_COLUMNS.length);
    }
  });

  it("formats dates through lib/tz rather than emitting raw ISO", () => {
    const first = reservationCsv([rows[0]]).split("\r\n")[1];
    expect(first).toContain("Aug 08 2026");
    expect(first).toContain("6:30 AM");
  });

  it("writes an em-dash where a pickup has no end time", () => {
    const pickup = rows.find((row) => row.endTime === null);
    expect(pickup).toBeDefined();
    if (pickup === undefined) return;
    // Start Time,End Time — anchored to its neighbour, since a bare "—" now
    // also appears in the unassigned driver, van and plate cells.
    expect(reservationCsv([pickup]).split("\r\n")[1]).toContain(
      `${formatPlainTime(pickup.startTime)},—,`,
    );
  });

  it("exports a header even with no rows", () => {
    expect(reservationCsv([])).toBe(EXPORT_COLUMNS.join(","));
  });

  // FR-16's report is where purpose, details, driver and van data are most
  // wanted; these columns must actually reach the file, not just the header.
  it("writes purpose, details, driver, van and plate", () => {
    const assigned = rows.find((row) => row.id === "REQ-1049");
    expect(assigned).toBeDefined();
    if (assigned === undefined) return;
    const line = reservationCsv([assigned]).split("\r\n")[1];
    expect(line).toContain("SLT Appointments");
    expect(line).toContain(
      "Bringing the SLT to the Manila office for the townhall.",
    );
    expect(line).toContain("Villanueva, Rey");
    expect(line).toContain("VAN-01");
    expect(line).toContain("NHU 8001");
  });

  // Manila wall-clock, not the ISO instant the row carries: a spreadsheet
  // opened elsewhere would otherwise disagree with the screen about the day.
  it("writes Last Updated as a Manila wall-clock time", () => {
    const updated = rows.find((row) => row.updatedAt !== null);
    expect(updated).toBeDefined();
    if (updated === undefined) return;
    const line = reservationCsv([updated]).split("\r\n")[1];
    expect(line).not.toContain(updated.updatedAt);
    // Quoted, because the formatted instant carries a comma of its own.
    expect(line.endsWith('PHT"')).toBe(true);
  });

  it("dashes Last Updated while nothing has happened to the request", () => {
    const untouched = rows.find((row) => row.updatedAt === null);
    expect(untouched).toBeDefined();
    if (untouched === undefined) return;
    expect(reservationCsv([untouched]).split("\r\n")[1].endsWith("—")).toBe(
      true,
    );
  });

  it("dashes driver, van and plate when none is assigned", () => {
    const unassigned = rows.find((row) => row.id === "REQ-1051");
    expect(unassigned).toBeDefined();
    if (unassigned === undefined) return;
    const line = reservationCsv([unassigned]).split("\r\n")[1];
    // Van Type,Driver,Van,Plate Number,Status — all three dashed cells in a
    // row, between the fields on either side of them.
    expect(line).toContain("Pickup / Drop-Off,—,—,—,Pending");
  });
});

describe("reportFileName", () => {
  it.each([
    [
      { site: "Manila", mode: "pickup", month: "2026-08" },
      "van-trips_manila_pickup_2026-08.csv",
    ],
    [
      { site: ALL, mode: ALL, month: ALL },
      "van-trips_all-sites_all-types_all-time.csv",
    ],
    [
      { site: "Iloilo", mode: "standby", month: ALL },
      "van-trips_iloilo_standby_all-time.csv",
    ],
  ] as const)("names %o as %s", (scope, expected) => {
    expect(reportFileName(scope)).toBe(expected);
  });

  // The design builds this from its display labels, one of which is
  // "Pickup/Drop Off" — a slash, which no platform allows in a filename.
  it("never contains a character a filesystem refuses", () => {
    const name = reportFileName({
      site: "Manila",
      mode: "pickup",
      month: "2026-08",
    });
    expect(name).toMatch(/^[a-z0-9_.-]+$/);
  });
});

/** Column count of one CSV line, respecting quoted sections. */
function countColumns(line: string): number {
  let columns = 1;
  let inQuotes = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (inQuotes && line[index + 1] === '"') index += 1;
      else inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      columns += 1;
    }
  }
  return columns;
}
