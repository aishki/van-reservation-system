import { redirect } from "next/navigation";
import { HomeView } from "@/components/requestor/home-view";
import { getSessionUser } from "@/modules/auth/service";

export default async function RequestorHomePage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  // Deliberately per-page, not hoisted into a `(requestor)` layout: a layout
  // does not re-execute on client-side navigation between sibling routes, so
  // a layout-only check would be a fail-open the moment a second requestor
  // page is added. Repeat this check on every requestor page instead of
  // DRYing it up.
  const user = await getSessionUser();
  if (user === null) redirect("/login");

  // Only the exact string opens the picker. Anything else — a typo, a stale
  // link, a probe — resolves to the resting hero rather than to an error.
  const { view } = await searchParams;

  return <HomeView initialView={view === "choose" ? "choose" : "hero"} />;
}
