import ExcelJS from "exceljs";
import { instantInManila } from "@/lib/tz";
import type { Driver } from "@/modules/drivers/types";
import type { ReportScope } from "@/modules/reservations/export";
import { TRIP_PURPOSES } from "@/modules/reservations/reference";
import {
  RESERVATION_STATUSES,
  type ReportRow,
  RIDE_MODE_LABELS,
  RIDE_MODES,
  SITE_LOCATIONS,
} from "@/modules/reservations/types";
import type { Van } from "@/modules/vans/types";

/**
 * The admin report export (FR-16) — a workbook, not a flat CSV.
 *
 * Three sheets, in dependency order: `Data` is the only sheet with real
 * values, everything else is a live formula against it, so the workbook stays
 * correct if opened after the rows change (recalculated by Excel/LibreOffice
 * on open, never baked in here). `Summary` aggregates `Data`. `Dashboard`
 * reads a handful of headline cells out of `Summary`.
 *
 * No charts: this runs in Node via `exceljs`, and no JS library on this stack
 * can write native Excel chart objects — that is a library ceiling, not an
 * oversight. `Dashboard` carries the same headline numbers a chart legend
 * would, as KPI tiles instead of a picture.
 */

const FONT = { name: "Arial", size: 10 } as const;
const TITLE_FONT = { name: "Arial", size: 18, bold: true } as const;
const HEADER_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF5009B5" }, // --color-brand
};
const HEADER_FONT = {
  name: "Arial",
  size: 10,
  bold: true,
  color: { argb: "FFFFFFFF" },
} as const;
const SECTION_FONT = { name: "Arial", size: 12, bold: true } as const;
const DATETIME_FORMAT = "mmm d, yyyy h:mm AM/PM";
const TIME_FORMAT = "h:mm AM/PM";
const MONTH_FORMAT = "mmm yyyy";

/**
 * The `Data` sheet's columns, in sheet order. The single source of truth for
 * every column letter used in a `Summary`/`Dashboard` formula — `colLetter`
 * derives the letter from a key's position here, so inserting a column never
 * silently misaligns a formula that was written against the old layout.
 */
const DATA_COLUMNS = [
  "reference",
  "status",
  "submitted",
  "start",
  "end",
  "requestor",
  "location",
  "from",
  "to",
  "purpose",
  "details",
  "vanType",
  "driver",
  "van",
  "plate",
  "vendor",
  "cost",
  "updatedBy",
  "lastUpdated",
  "firstAssigned",
  "month",
  "weekday",
  "leadTime",
  "assigned",
  "tat",
  "withinSla",
  "pendingAge",
] as const;
type DataColumn = (typeof DATA_COLUMNS)[number];

function colLetter(key: DataColumn): string {
  const index = DATA_COLUMNS.indexOf(key) + 1;
  let n = index;
  let letters = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

const HEADERS: Record<DataColumn, string> = {
  reference: "Reference",
  status: "Status",
  submitted: "Date Submitted (PHT)",
  start: "Start Date & Time",
  end: "End Time",
  requestor: "Requestor",
  location: "Location",
  from: "From",
  to: "To",
  purpose: "Purpose",
  details: "Details",
  vanType: "Van Type",
  driver: "Driver",
  van: "Van",
  plate: "Plate Number",
  vendor: "Vendor",
  cost: "Additional Cost (PHP)",
  updatedBy: "Updated By",
  lastUpdated: "Last Updated (PHT)",
  firstAssigned: "First Assigned (PHT)",
  month: "Month",
  weekday: "Weekday",
  leadTime: "Lead Time (Days)",
  assigned: "Assigned",
  tat: "TAT (Hrs)",
  withinSla: "Within SLA (<=12h)",
  pendingAge: "Pending Age (Days)",
};

/**
 * Manila wall-clock (a `YYYY-MM-DD` plus an `HH:mm`) as a naive datetime
 * `Date` — one whose UTC components ARE the wall-clock values, so writing it
 * to a cell and formatting it as a date renders the Manila time with no
 * further offset. Excel/`exceljs` serial dates carry no timezone of their
 * own; this is the standard way to hand one a value with no double-shift.
 */
function plainDateTime(date: string, time: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mi] = time.split(":").map(Number);
  return new Date(Date.UTC(y, m - 1, d, hh, mi));
}

/** An ISO instant → the same naive Manila datetime `plainDateTime` builds. */
function manilaDateTime(instant: string | null): Date | null {
  if (instant === null) return null;
  const parsed = instantInManila(new Date(instant));
  if (parsed === null) return null;
  return plainDateTime(parsed.date, parsed.time);
}

/** A bare `HH:mm` as a time-only cell: the date half sits on the Excel epoch. */
function plainTime(time: string | null): Date | null {
  if (time === null) return null;
  return plainDateTime("1899-12-30", time);
}

function styleHeaderRow(row: ExcelJS.Row): void {
  row.eachCell((cell) => {
    cell.font = HEADER_FONT;
    cell.fill = HEADER_FILL;
    cell.alignment = { vertical: "middle" };
  });
  row.height = 20;
}

function writeDataSheet(wb: ExcelJS.Workbook, rows: readonly ReportRow[]) {
  const sheet = wb.addWorksheet("Data", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  sheet.columns = DATA_COLUMNS.map((key) => ({
    header: HEADERS[key],
    key,
    width: key === "details" ? 40 : 16,
  }));
  styleHeaderRow(sheet.getRow(1));

  const last = rows.length + 1;
  rows.forEach((row, i) => {
    const r = i + 2;
    const start = plainDateTime(row.startDate, row.startTime);
    const submitted = manilaDateTime(row.submittedAt);
    const c = colLetter;

    sheet.getRow(r).values = {
      reference: row.id,
      status: row.status,
      submitted,
      start,
      end: plainTime(row.endTime),
      requestor: row.requestor,
      location: row.site,
      from: row.from,
      to: row.to,
      purpose: row.purpose,
      details: row.details,
      vanType: RIDE_MODE_LABELS[row.mode].title,
      // Left `undefined` (a true blank cell), never `""` — Excel's `COUNTA`
      // treats an empty-string cell as non-blank, which would make "Trips
      // with Vendor Recorded" count every row instead of only the ones with
      // a vendor on file.
      driver: row.driver ?? undefined,
      van: row.vanLabel ?? undefined,
      plate: row.vanPlate ?? undefined,
      vendor: row.vendor ?? undefined,
      cost: row.costPhp ?? undefined,
      updatedBy: row.updatedBy ?? undefined,
      lastUpdated: manilaDateTime(row.updatedAt),
      firstAssigned: manilaDateTime(row.firstAssignedAt ?? null),
      month: { formula: `TEXT(${c("start")}${r},"mmm yyyy")` },
      weekday: { formula: `TEXT(${c("start")}${r},"ddd")` },
      leadTime: {
        formula: `INT(${c("start")}${r})-INT(${c("submitted")}${r})`,
      },
      assigned: {
        formula: `IF(${c("driver")}${r}="","No","Yes")`,
      },
      tat: {
        formula:
          `IF(AND(${c("assigned")}${r}="Yes",${c("firstAssigned")}${r}<>""),` +
          `ROUND((${c("firstAssigned")}${r}-${c("submitted")}${r})*24,1),"")`,
      },
      withinSla: {
        formula: `IF(${c("tat")}${r}="","N/A",IF(${c("tat")}${r}<=12,"Yes","No"))`,
      },
      pendingAge: {
        formula: `IF(${c("status")}${r}="Pending",TODAY()-INT(${c("submitted")}${r}),"")`,
      },
    } satisfies Record<DataColumn, ExcelJS.CellValue>;

    sheet.getCell(r, DATA_COLUMNS.indexOf("submitted") + 1).numFmt =
      DATETIME_FORMAT;
    sheet.getCell(r, DATA_COLUMNS.indexOf("start") + 1).numFmt =
      DATETIME_FORMAT;
    sheet.getCell(r, DATA_COLUMNS.indexOf("end") + 1).numFmt = TIME_FORMAT;
    sheet.getCell(r, DATA_COLUMNS.indexOf("lastUpdated") + 1).numFmt =
      DATETIME_FORMAT;
    sheet.getCell(r, DATA_COLUMNS.indexOf("firstAssigned") + 1).numFmt =
      DATETIME_FORMAT;
    sheet.getCell(r, DATA_COLUMNS.indexOf("cost") + 1).numFmt = "#,##0";
  });

  for (const row of sheet.getRows(1, last) ?? []) {
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.font = cell.font?.bold ? cell.font : FONT;
    });
  }

  return { sheet, last };
}

/** `Data!$<col>$2:$<col>$<last>`. */
function dataRange(col: DataColumn, last: number): string {
  const letter = colLetter(col);
  return `Data!$${letter}$2:$${letter}$${last}`;
}

interface SummaryLayout {
  /** Row of each status in the "Status Breakdown" table, by status label. */
  statusRow: Map<string, number>;
  approvedRow: number;
  pendingRow: number;
  avgTatRow: number;
  slaComplianceRow: number;
  withinSlaRow: number;
  breachedSlaRow: number;
  tripsAssignedRow: number;
}

function writeSummarySheet(
  wb: ExcelJS.Workbook,
  last: number,
  requestors: readonly string[],
  drivers: readonly Driver[],
  vans: readonly Van[],
  months: readonly string[],
): SummaryLayout {
  const sheet = wb.addWorksheet("Summary");
  sheet.columns = [
    { width: 32 },
    { width: 16 },
    { width: 16 },
    { width: 20 },
    { width: 16 },
    { width: 20 },
    { width: 16 },
    { width: 16 },
  ];

  let r = 1;
  const section = (title: string) => {
    sheet.getCell(r, 1).value = title;
    sheet.getCell(r, 1).font = SECTION_FONT;
    r += 2;
  };
  const tableHeader = (...cells: (string | null)[]) => {
    cells.forEach((label, i) => {
      if (label === null) return;
      const cell = sheet.getCell(r, i + 1);
      cell.value = label;
      cell.font = { ...FONT, bold: true };
    });
    r += 1;
  };

  // ── Status Breakdown ──────────────────────────────────────────────────
  section("Status Breakdown");
  tableHeader("Status", "Count", "% of Total");
  const statusFirstRow = r;
  const statusRow = new Map<string, number>();
  for (const status of RESERVATION_STATUSES) {
    statusRow.set(status, r);
    sheet.getCell(r, 1).value = status;
    sheet.getCell(r, 2).value = {
      formula: `COUNTIF(${dataRange("status", last)},A${r})`,
    };
    r += 1;
  }
  const statusLastRow = r - 1;
  for (let row = statusFirstRow; row <= statusLastRow; row++) {
    sheet.getCell(row, 3).value = {
      formula: `IFERROR(B${row}/SUM($B$${statusFirstRow}:$B$${statusLastRow}),0)`,
    };
    sheet.getCell(row, 3).numFmt = "0.0%";
  }
  sheet.getCell(r, 1).value = "Total";
  sheet.getCell(r, 1).font = { ...FONT, bold: true };
  sheet.getCell(r, 2).value = {
    formula: `SUM(B${statusFirstRow}:B${statusLastRow})`,
  };
  r += 2;

  // ── Monthly Trend ─────────────────────────────────────────────────────
  section("Monthly Trend");
  tableHeader("Month", "Total", "Approved", "Pending", "Rejected", "Cancelled");
  for (const month of months) {
    const cell = sheet.getCell(r, 1);
    cell.value = plainDateTime(`${month}-01`, "00:00");
    cell.numFmt = MONTH_FORMAT;
    sheet.getCell(r, 2).value = {
      formula: `COUNTIF(${dataRange("month", last)},TEXT(A${r},"mmm yyyy"))`,
    };
    sheet.getCell(r, 3).value = {
      formula:
        `COUNTIFS(${dataRange("month", last)},TEXT(A${r},"mmm yyyy"),${dataRange("status", last)},"Approved")` +
        `+COUNTIFS(${dataRange("month", last)},TEXT(A${r},"mmm yyyy"),${dataRange("status", last)},"Approved - Driver Reassigned")`,
    };
    sheet.getCell(r, 4).value = {
      formula: `COUNTIFS(${dataRange("month", last)},TEXT(A${r},"mmm yyyy"),${dataRange("status", last)},"Pending")`,
    };
    sheet.getCell(r, 5).value = {
      formula: `COUNTIFS(${dataRange("month", last)},TEXT(A${r},"mmm yyyy"),${dataRange("status", last)},"Rejected")`,
    };
    sheet.getCell(r, 6).value = {
      formula: `COUNTIFS(${dataRange("month", last)},TEXT(A${r},"mmm yyyy"),${dataRange("status", last)},"Cancelled")`,
    };
    r += 1;
  }
  r += 1;

  // ── Trips by Purpose / By Location / By Van Type ────────────────────
  section("Trips by Purpose");
  sheet.getCell(r - 2, 4).value = "By Location";
  sheet.getCell(r - 2, 4).font = SECTION_FONT;
  sheet.getCell(r - 2, 6).value = "By Van Type";
  sheet.getCell(r - 2, 6).font = SECTION_FONT;
  tableHeader(
    "Purpose",
    "Count",
    null,
    "Location",
    "Count",
    "Van Type",
    "Count",
  );
  const breakdownStart = r;
  const rowCount = Math.max(
    TRIP_PURPOSES.length,
    SITE_LOCATIONS.length,
    RIDE_MODES.length,
  );
  for (let i = 0; i < rowCount; i++) {
    const row = breakdownStart + i;
    if (i < TRIP_PURPOSES.length) {
      sheet.getCell(row, 1).value = TRIP_PURPOSES[i];
      sheet.getCell(row, 2).value = {
        formula: `COUNTIF(${dataRange("purpose", last)},A${row})`,
      };
    }
    if (i < SITE_LOCATIONS.length) {
      sheet.getCell(row, 4).value = SITE_LOCATIONS[i];
      sheet.getCell(row, 5).value = {
        formula: `COUNTIF(${dataRange("location", last)},D${row})`,
      };
    }
    if (i < RIDE_MODES.length) {
      const mode = RIDE_MODES[i];
      sheet.getCell(row, 6).value = RIDE_MODE_LABELS[mode].title;
      sheet.getCell(row, 7).value = {
        formula: `COUNTIF(${dataRange("vanType", last)},F${row})`,
      };
    }
  }
  r = breakdownStart + rowCount + 1;

  // ── By Requestor ──────────────────────────────────────────────────────
  section("By Requestor");
  tableHeader("Requestor", "Total Requests", "Approved", "Approval Rate");
  for (const name of requestors) {
    sheet.getCell(r, 1).value = name;
    sheet.getCell(r, 2).value = {
      formula: `COUNTIF(${dataRange("requestor", last)},A${r})`,
    };
    sheet.getCell(r, 3).value = {
      formula:
        `COUNTIFS(${dataRange("requestor", last)},A${r},${dataRange("status", last)},"Approved")` +
        `+COUNTIFS(${dataRange("requestor", last)},A${r},${dataRange("status", last)},"Approved - Driver Reassigned")`,
    };
    sheet.getCell(r, 4).value = {
      formula: `IF(B${r}=0,0,C${r}/B${r})`,
    };
    sheet.getCell(r, 4).numFmt = "0.0%";
    r += 1;
  }
  r += 1;

  // ── Driver Utilization / Van Utilization ─────────────────────────────
  section("Driver Utilization (assigned trips)");
  sheet.getCell(r - 2, 4).value = "Van Utilization";
  sheet.getCell(r - 2, 4).font = SECTION_FONT;
  tableHeader("Driver", "Trips Assigned", null, "Van", "Trips");
  const utilStart = r;
  const utilRows = Math.max(drivers.length, vans.length);
  for (let i = 0; i < utilRows; i++) {
    const row = utilStart + i;
    if (i < drivers.length) {
      sheet.getCell(row, 1).value = drivers[i].name;
      sheet.getCell(row, 2).value = {
        formula: `COUNTIF(${dataRange("driver", last)},A${row})`,
      };
    }
    if (i < vans.length) {
      sheet.getCell(row, 4).value = vans[i].vanNumber;
      sheet.getCell(row, 5).value = {
        formula: `COUNTIF(${dataRange("van", last)},D${row})`,
      };
    }
  }
  r = utilStart + utilRows + 1;

  // ── Timing & SLA Stats ────────────────────────────────────────────────
  section("Timing & SLA Stats");
  tableHeader("Metric", "Value");
  sheet.getCell(r, 1).value = "Avg Lead Time - all requests (days)";
  sheet.getCell(r, 2).value = {
    formula: `ROUND(AVERAGE(${dataRange("leadTime", last)}),1)`,
  };
  r += 1;
  const avgTatRow = r;
  sheet.getCell(r, 1).value = "Avg TAT - submission to first assignment (hrs)";
  sheet.getCell(r, 2).value = {
    formula: `IFERROR(ROUND(AVERAGE(${dataRange("tat", last)}),1),0)`,
  };
  r += 1;
  sheet.getCell(r, 1).value = "Oldest Pending Request (days since submitted)";
  sheet.getCell(r, 2).value = {
    formula: `IFERROR(MAX(${dataRange("pendingAge", last)}),0)`,
  };
  r += 1;
  const tripsAssignedRow = r;
  sheet.getCell(r, 1).value = "Trips Assigned (basis for SLA)";
  sheet.getCell(r, 2).value = {
    formula: `COUNTIF(${dataRange("withinSla", last)},"Yes")+COUNTIF(${dataRange("withinSla", last)},"No")`,
  };
  r += 1;
  const withinSlaRow = r;
  sheet.getCell(r, 1).value = "Within SLA (<=12h)";
  sheet.getCell(r, 2).value = {
    formula: `COUNTIF(${dataRange("withinSla", last)},"Yes")`,
  };
  r += 1;
  const breachedSlaRow = r;
  sheet.getCell(r, 1).value = "Breached SLA (>12h)";
  sheet.getCell(r, 2).value = {
    formula: `COUNTIF(${dataRange("withinSla", last)},"No")`,
  };
  r += 1;
  const slaComplianceRow = r;
  sheet.getCell(r, 1).value = "SLA Compliance %";
  sheet.getCell(r, 2).value = {
    formula: `IFERROR(B${withinSlaRow}/B${tripsAssignedRow},0)`,
  };
  sheet.getCell(r, 2).numFmt = "0.0%";
  r += 2;

  // ── Additional Cost Summary ───────────────────────────────────────────
  section(
    "Additional Cost Summary (fill in Vendor/Additional Cost on Data sheet)",
  );
  tableHeader("Metric", "Value");
  sheet.getCell(r, 1).value = "Total Additional Cost";
  sheet.getCell(r, 2).value = { formula: `SUM(${dataRange("cost", last)})` };
  sheet.getCell(r, 2).numFmt = "#,##0";
  r += 1;
  sheet.getCell(r, 1).value = "Avg Additional Cost per Trip (recorded only)";
  sheet.getCell(r, 2).value = {
    formula: `IFERROR(AVERAGE(${dataRange("cost", last)}),0)`,
  };
  sheet.getCell(r, 2).numFmt = "#,##0";
  r += 1;
  sheet.getCell(r, 1).value = "Trips with Additional Cost Recorded";
  sheet.getCell(r, 2).value = { formula: `COUNT(${dataRange("cost", last)})` };
  r += 1;
  sheet.getCell(r, 1).value = "Trips with Vendor Recorded";
  sheet.getCell(r, 2).value = {
    formula: `COUNTA(${dataRange("vendor", last)})`,
  };

  sheet.eachRow((row) => {
    row.eachCell((cell) => {
      if (!cell.font || cell.font === FONT) cell.font = FONT;
    });
  });

  return {
    statusRow,
    approvedRow: statusRow.get("Approved") ?? statusFirstRow,
    pendingRow: statusRow.get("Pending") ?? statusFirstRow,
    avgTatRow,
    slaComplianceRow,
    withinSlaRow,
    breachedSlaRow,
    tripsAssignedRow,
  };
}

function writeDashboardSheet(
  wb: ExcelJS.Workbook,
  last: number,
  layout: SummaryLayout,
) {
  const sheet = wb.addWorksheet("Dashboard");
  sheet.columns = Array.from({ length: 8 }, () => ({ width: 18 }));

  sheet.getCell(1, 1).value = "Van Trip Reservations — Admin Dashboard";
  sheet.getCell(1, 1).font = TITLE_FONT;
  sheet.mergeCells(1, 1, 1, 8);

  sheet.getCell(3, 1).value = {
    formula:
      `CONCATENATE("Covering ",TEXT(MIN(${dataRange("start", last)}),"mmm d, yyyy")," to ",` +
      `TEXT(MAX(${dataRange("start", last)}),"mmm d, yyyy")," — ",COUNTA(${dataRange("reference", last)})," total requests")`,
  };
  sheet.mergeCells(3, 1, 3, 8);

  const tile = (
    row: number,
    col: number,
    label: string,
    formula: string,
    numFmt?: string,
  ) => {
    const labelCell = sheet.getCell(row, col);
    labelCell.value = label;
    labelCell.font = { ...FONT, bold: true, color: { argb: "FF666666" } };
    const valueCell = sheet.getCell(row + 1, col);
    valueCell.value = { formula };
    valueCell.font = { name: "Arial", size: 16, bold: true };
    if (numFmt) valueCell.numFmt = numFmt;
  };

  tile(5, 2, "TOTAL REQUESTS", `COUNTA(${dataRange("reference", last)})`);
  tile(
    5,
    4,
    "APPROVED",
    `Summary!B${layout.approvedRow}+Summary!B${
      layout.statusRow.get("Approved - Driver Reassigned") ?? layout.approvedRow
    }`,
  );
  tile(5, 6, "AVG TAT (hrs)", `Summary!B${layout.avgTatRow}`);
  tile(5, 9, "SLA %", `Summary!B${layout.slaComplianceRow}`, "0.0%");
  tile(5, 11, "PENDING NOW", `Summary!B${layout.pendingRow}`);

  sheet.getCell(9, 1).value = "SLA Compliance";
  sheet.getCell(9, 1).font = SECTION_FONT;
  sheet.getCell(10, 1).value =
    "TAT (turnaround time) is measured from submission to the first driver " +
    "assignment (i.e. when a request is Approved). A trip is within SLA if " +
    "that gap is 12 hours or less. If a driver is later reassigned, the " +
    "first-assignment time still applies.";
  sheet.getCell(10, 1).alignment = { wrapText: true };
  sheet.mergeCells(10, 1, 10, 8);
  sheet.getRow(10).height = 40;

  tile(12, 2, "SLA COMPLIANCE", `Summary!B${layout.slaComplianceRow}`, "0.0%");
  tile(12, 4, "WITHIN SLA", `Summary!B${layout.withinSlaRow}`);
  tile(12, 6, "BREACHED SLA", `Summary!B${layout.breachedSlaRow}`);
  tile(12, 9, "TRIPS ASSIGNED", `Summary!B${layout.tripsAssignedRow}`);

  sheet.eachRow((row) => {
    row.eachCell((cell) => {
      if (!cell.font) cell.font = FONT;
    });
  });
}

/**
 * The workbook `/api/reports/export` streams back. `rows` is already scoped
 * (site/mode/month) by the caller — this function has no filtering opinion of
 * its own. `drivers`/`vans` are the ACTIVE roster, so the utilization tables
 * name every current driver/van at zero rather than omitting one this scope
 * happened not to touch.
 */
export function buildReportWorkbook(
  rows: readonly ReportRow[],
  drivers: readonly Driver[],
  vans: readonly Van[],
  _scope: ReportScope,
): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Van Reservation System";
  wb.created = new Date();

  const { last } = writeDataSheet(wb, rows);

  const requestors = [...new Set(rows.map((row) => row.requestor))].sort(
    (a, b) => a.localeCompare(b),
  );
  const months = [
    ...new Set(
      rows
        .map((row) => row.startDate.slice(0, 7))
        .filter((m) => /^\d{4}-\d{2}$/.test(m)),
    ),
  ].sort();
  const activeDrivers = drivers.filter((d) => d.active);
  const activeVans = vans.filter((v) => v.active);

  const layout = writeSummarySheet(
    wb,
    Math.max(last, 2),
    requestors,
    activeDrivers,
    activeVans,
    months,
  );
  writeDashboardSheet(wb, Math.max(last, 2), layout);

  return wb;
}
