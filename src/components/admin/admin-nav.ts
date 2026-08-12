import {
  CalendarDays,
  ClipboardList,
  FileBarChart2,
  LayoutDashboard,
  ScrollText,
  Table2,
  Users,
} from "lucide-react";

/**
 * The admin sidebar's seven destinations.
 *
 * `href` values must stay in step with `ADMIN_PREFIXES` in `middleware.ts` —
 * that list is what actually gates these routes, and `middleware.test.ts`
 * enumerates the route directories to catch a new one that forgets to register.
 *
 * ICONS ARE A SUBSTITUTION. The design marks each slot
 * `<!-- icon slot → public/figma/icon-*.svg -->` and draws a placeholder square
 * with a per-item border radius; no icon assets were delivered. These are
 * lucide glyphs, chosen because lucide-react is already a dependency of this
 * project (`components/ui/sonner.tsx` uses it) and because a generic nav glyph
 * is a functional slot rather than a specific piece of artwork — unlike the van
 * photograph, drawing one from a library is not inventing someone's design.
 * Swap them for the real exports when they arrive; nothing else changes.
 *
 * `title` is the topbar heading, which is NOT always the nav label: the design
 * shows "Report Generation" in the sidebar and "Reports" as the page title.
 */
export const ADMIN_NAV = [
  {
    key: "dashboard",
    href: "/dashboard",
    label: "Dashboard",
    title: "Dashboard",
    Icon: LayoutDashboard,
  },
  {
    key: "master-list",
    href: "/master-list",
    label: "Master List",
    title: "Master List",
    Icon: Table2,
  },
  {
    key: "reports",
    href: "/reports",
    label: "Report Generation",
    title: "Reports",
    Icon: FileBarChart2,
  },
  {
    key: "drivers",
    href: "/drivers",
    label: "Driver Workload",
    title: "Driver Workload",
    Icon: Users,
  },
  {
    key: "roster",
    href: "/roster",
    label: "Roster",
    title: "Roster",
    Icon: ClipboardList,
  },
  {
    key: "audit-logs",
    href: "/audit-logs",
    label: "Audit Logs",
    title: "Audit Logs",
    Icon: ScrollText,
  },
  {
    key: "calendar",
    href: "/calendar",
    label: "Calendar",
    title: "Calendar",
    Icon: CalendarDays,
  },
] as const;

export type AdminNavKey = (typeof ADMIN_NAV)[number]["key"];

/**
 * Initials for the topbar avatar, always given-name first.
 *
 * Two name formats reach this. The design's sample data and the booking form both
 * use "Last, First" ("Jimera, Arielle" → "AJ"); reading that left to right would
 * give "JA", which is a different person's monogram. But the dev identity
 * fixtures — and, most likely, whatever the real auth API returns — use plain
 * "First Last" ("Ivy Balandra" → "IB"). Handling only the comma form silently
 * produced a single letter for every one of those.
 *
 * Falls back to "?" rather than an empty circle, so an unparseable name still
 * renders something with a shape.
 */
export function initialsFor(name: string): string {
  const trimmed = name.trim();
  if (trimmed === "") return "?";

  const [last = "", first = ""] = trimmed.includes(",")
    ? trimmed.split(",").map((part) => part.trim())
    : (() => {
        const words = trimmed.split(/\s+/);
        // "First Last" and "First Middle Last" both take first + last word.
        return [words.at(-1) ?? "", words[0] ?? ""];
      })();

  const letters = [first.at(0), last.at(0)].filter(Boolean).join("");
  return letters === "" ? "?" : letters.toUpperCase();
}
