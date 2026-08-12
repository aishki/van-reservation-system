import Image from "next/image";
import Link from "next/link";
import { ADMIN_NAV, type AdminNavKey } from "@/components/admin/admin-nav";
import { AdminTopbar } from "@/components/admin/admin-topbar";
import { cn } from "@/lib/utils";

interface AdminShellProps {
  active: AdminNavKey;
  userName: string;
  children: React.ReactNode;
}

/**
 * The admin frame: a fixed 256px sidebar, a sticky topbar, and the working area.
 *
 * Replaces the placeholder sidebar written in Slice 1 — five plain text links
 * with no icons, no active state and no `aria-current` — which was invented
 * because the Figma shell frames were never captured before the MCP paywall.
 * This one is built from the Claude Design project's `Admin UI.dc.html`.
 *
 * The sidebar's logo slots are dashed placeholders in the design document, but
 * the real lockups are committed, so they are used. Note only TWO appear here
 * (Carelon and BI&T) — the requestor header carries three. That asymmetry is the
 * design's, not an omission.
 *
 * The sidebar is `sticky top-0` with its own overflow, so the nav stays put while
 * a long master list scrolls, and on a short viewport it scrolls independently
 * rather than clipping its last item.
 */
export function AdminShell({ active, userName, children }: AdminShellProps) {
  const title =
    ADMIN_NAV.find((item) => item.key === active)?.title ?? "Dashboard";

  return (
    <div className="flex min-h-dvh flex-1 bg-background">
      <aside className="sticky top-0 hidden h-dvh w-64 flex-none overflow-y-auto border-r border-gray-6 py-[26px] md:block">
        <div className="flex flex-col gap-2.5 px-[22px] pb-[34px]">
          <Image
            src="/figma/carelon-global-solutions-logo.png"
            alt="Carelon Global Solutions"
            width={2486}
            height={647}
            sizes="130px"
            className="block h-6 w-auto self-start object-contain"
          />
          <Image
            src="/figma/business-intelligence-transformation-solutions-logo.png"
            alt="Business Intelligence & Transformation Solutions"
            width={240}
            height={135}
            sizes="54px"
            className="block h-[30px] w-auto self-start object-contain"
          />
        </div>

        <nav className="flex flex-col gap-1.5 px-3.5">
          {ADMIN_NAV.map((item) => {
            const isActive = item.key === active;
            return (
              <Link
                key={item.key}
                href={item.href}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "flex items-center gap-3.5 rounded-field px-4 py-3.5 text-[1.0625rem] whitespace-nowrap focus-visible:outline-3 focus-visible:-outline-offset-2 focus-visible:outline-primary",
                  isActive
                    ? "bg-brand font-semibold text-primary-foreground"
                    : "text-gray-1 hover:bg-gray-5",
                )}
              >
                <item.Icon aria-hidden="true" className="size-5 flex-none" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <AdminTopbar title={title} userName={userName} />

        {/* Mobile nav. The design is desktop-only — an admin console for dense
            tables reasonably assumes a desktop — but a sidebar hidden below `md`
            with no replacement would strand a phone user on whichever page they
            first landed on. */}
        <nav className="flex gap-2 overflow-x-auto border-b border-gray-6 bg-background px-4 py-3 md:hidden">
          {ADMIN_NAV.map((item) => {
            const isActive = item.key === active;
            return (
              <Link
                key={item.key}
                href={item.href}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "flex flex-none items-center gap-2 rounded-pill border px-3.5 py-2 text-sm font-medium",
                  isActive
                    ? "border-brand bg-brand text-primary-foreground"
                    : "border-gray-4 text-gray-1",
                )}
              >
                <item.Icon aria-hidden="true" className="size-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <main className="relative min-w-0 flex-1 bg-gray-5">
          <div
            aria-hidden="true"
            className="admin-weave pointer-events-none absolute inset-0 opacity-50"
          />
          <div className="relative">{children}</div>
        </main>
      </div>
    </div>
  );
}
