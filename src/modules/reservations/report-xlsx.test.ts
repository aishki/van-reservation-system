import { describe, expect, it } from "vitest";
import type { Driver } from "@/modules/drivers/types";
import { buildReportWorkbook } from "@/modules/reservations/report-xlsx";
import type { ReportRow } from "@/modules/reservations/types";
import type { Van } from "@/modules/vans/types";
import { sampleAdminRequests } from "@/test-fixtures/reservations";

const DRIVERS: Driver[] = [
  {
    id: "d1",
    name: "Ocampo, Dennis",
    mobile: "0900",
    site: "Manila",
    shift: null,
    active: true,
  },
  {
    id: "d2",
    name: "Retired, Driver",
    mobile: "0901",
    site: "Manila",
    shift: null,
    active: false,
  },
];

const VANS: Van[] = [
  {
    id: "v1",
    vanNumber: "VAN-001",
    plate: "ABC-123",
    carType: "Van",
    site: "Manila",
    active: true,
  },
  {
    id: "v2",
    vanNumber: "VAN-999",
    plate: "ZZZ-999",
    carType: "Van",
    site: "Manila",
    active: false,
  },
];

/** `sampleAdminRequests` rows plus the vendor/cost report needs, and one row
 * with neither so the "blank, not empty-string" cell rule stays covered. */
function reportRows(): ReportRow[] {
  return sampleAdminRequests().map((row, i) => ({
    ...row,
    vendor: i === 0 ? "Rent-A-Van Corp" : null,
    costPhp: i === 0 ? 3500 : null,
  }));
}

function cellValue(sheet: import("exceljs").Worksheet, addr: string) {
  return sheet.getCell(addr).value;
}

describe("buildReportWorkbook", () => {
  const scope = { site: "All", mode: "All", month: "All" } as const;

  it("builds exactly Data, Summary and Dashboard, in that order", () => {
    const wb = buildReportWorkbook(reportRows(), DRIVERS, VANS, scope);
    expect(wb.worksheets.map((s) => s.name)).toEqual([
      "Data",
      "Summary",
      "Dashboard",
    ]);
  });

  it("headers the Data sheet with the renamed cost/costing vocabulary", () => {
    const wb = buildReportWorkbook(reportRows(), DRIVERS, VANS, scope);
    const data = wb.getWorksheet("Data");
    if (!data) throw new Error("Data sheet missing");
    expect(cellValue(data, "A1")).toBe("Reference");
    expect(cellValue(data, "Q1")).toBe("Additional Cost (PHP)");
  });

  it("writes vendor/cost as real values and leaves the rest a true blank", () => {
    const wb = buildReportWorkbook(reportRows(), DRIVERS, VANS, scope);
    const data = wb.getWorksheet("Data");
    if (!data) throw new Error("Data sheet missing");
    // Row 2 is the first fixture row, which carries vendor/cost.
    expect(cellValue(data, "P2")).toBe("Rent-A-Van Corp");
    expect(cellValue(data, "Q2")).toBe(3500);
    // Row 3's fixture has neither — a true blank (null), never "".
    expect(cellValue(data, "P3")).toBeNull();
    expect(cellValue(data, "Q3")).toBeNull();
  });

  it("writes the TAT formula against First Assigned, not Last Updated", () => {
    const wb = buildReportWorkbook(reportRows(), DRIVERS, VANS, scope);
    const data = wb.getWorksheet("Data");
    if (!data) throw new Error("Data sheet missing");
    const formula = cellValue(data, "Y2");
    expect(formula).toMatchObject({
      formula: expect.stringContaining("T2-C2"),
    });
  });

  it("only lists the active driver and van in the utilization tables", () => {
    const wb = buildReportWorkbook(reportRows(), DRIVERS, VANS, scope);
    const summary = wb.getWorksheet("Summary");
    if (!summary) throw new Error("Summary sheet missing");
    const names = new Set<unknown>();
    for (let r = 1; r <= summary.rowCount; r++) {
      names.add(cellValue(summary, `A${r}`));
      names.add(cellValue(summary, `D${r}`));
    }
    expect(names.has("Ocampo, Dennis")).toBe(true);
    expect(names.has("Retired, Driver")).toBe(false);
    expect(names.has("VAN-001")).toBe(true);
    expect(names.has("VAN-999")).toBe(false);
  });

  it("renames the Costing/Cost tables on the Summary sheet", () => {
    const wb = buildReportWorkbook(reportRows(), DRIVERS, VANS, scope);
    const summary = wb.getWorksheet("Summary");
    if (!summary) throw new Error("Summary sheet missing");
    const titles = new Set<unknown>();
    for (let r = 1; r <= summary.rowCount; r++) {
      titles.add(cellValue(summary, `A${r}`));
    }
    expect(
      [...titles].some(
        (v) => typeof v === "string" && v.startsWith("Additional Cost Summary"),
      ),
    ).toBe(true);
    expect([...titles]).toContain("Total Additional Cost");
    expect([...titles]).toContain("Trips with Vendor Recorded");
  });

  it("wires the Dashboard KPI tiles to Summary, not Data, directly", () => {
    const wb = buildReportWorkbook(reportRows(), DRIVERS, VANS, scope);
    const dashboard = wb.getWorksheet("Dashboard");
    if (!dashboard) throw new Error("Dashboard sheet missing");
    const totalRequests = cellValue(dashboard, "B6");
    expect(totalRequests).toMatchObject({
      formula: expect.stringContaining("COUNTA(Data!"),
    });
    const slaPercent = cellValue(dashboard, "I6");
    expect(slaPercent).toMatchObject({
      formula: expect.stringContaining("Summary!B"),
    });
  });

  it("produces a workbook with no rows without throwing", () => {
    expect(() => buildReportWorkbook([], [], [], scope)).not.toThrow();
  });
});
