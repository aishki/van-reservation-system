import { errorResponse } from "@/lib/api-error";
import { requireAdmin } from "@/modules/auth/service";
import { getDb } from "@/modules/db/client";
import { listDrivers } from "@/modules/drivers/repo";
import {
  ALL,
  filterReportScope,
  type ModeFilter,
  type SiteFilter,
} from "@/modules/reservations/admin-filters";
import {
  type ReportScope,
  reportFileName,
} from "@/modules/reservations/export";
import { listReservationsForReport } from "@/modules/reservations/repo";
import { buildReportWorkbook } from "@/modules/reservations/report-xlsx";
import {
  isRideMode,
  SITE_LOCATIONS,
  type SiteLocation,
} from "@/modules/reservations/types";
import { listVans } from "@/modules/vans/repo";

function siteFilterFrom(value: string | null): SiteFilter | null {
  if (value === null || value === ALL) return ALL;
  return (SITE_LOCATIONS as readonly string[]).includes(value)
    ? (value as SiteLocation)
    : null;
}

function modeFilterFrom(value: string | null): ModeFilter | null {
  if (value === null || value === ALL) return ALL;
  return isRideMode(value) ? value : null;
}

/**
 * The Report Generation admin screen's download (FR-16). Re-applies the
 * site/van-type/month scope SERVER-SIDE from the query string — the client's
 * row count is a preview, never the authority, so a crafted request cannot
 * widen what leaves the building beyond what the three filters name.
 *
 * The `.xlsx` itself — `Data`/`Summary`/`Dashboard`, formulas throughout — is
 * built by `buildReportWorkbook`; this route only owns scope, auth, and the
 * response envelope.
 */
export async function GET(req: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return errorResponse(
      admin.error,
      "Only Admin Support can generate reports.",
    );
  }

  const params = new URL(req.url).searchParams;
  const site = siteFilterFrom(params.get("site"));
  const mode = modeFilterFrom(params.get("mode"));
  const month = params.get("month") ?? ALL;
  if (site === null || mode === null) {
    return errorResponse(
      "VALIDATION_FAILED",
      "That report scope is not valid.",
    );
  }
  const scope: ReportScope = { site, mode, month };

  const db = getDb();
  const [rows, drivers, vans] = await Promise.all([
    listReservationsForReport(db),
    listDrivers(db),
    listVans(db),
  ]);

  const scoped = filterReportScope(rows, scope);
  const workbook = buildReportWorkbook(scoped, drivers, vans, scope);
  const buffer = await workbook.xlsx.writeBuffer();

  return new Response(buffer, {
    headers: {
      "content-type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="${reportFileName(scope)}"`,
    },
  });
}
