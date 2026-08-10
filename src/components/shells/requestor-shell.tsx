import {
  RequestorHeader,
  type RequestorNavItem,
} from "@/components/requestor/requestor-header";
import { cn } from "@/lib/utils";

interface RequestorShellProps {
  active: RequestorNavItem;
  children: React.ReactNode;
  /** Page background. Each surface sets its own — the design uses gray-5 for
   *  Manage and `--color-brand-wash` for the wizard, not one shared canvas. */
  className?: string;
}

/**
 * Header-plus-main wrapper for every requestor route EXCEPT the landing page.
 *
 * The landing page composes `RequestorHeader` itself, because its "Book" nav
 * item swaps the hero in place rather than navigating, and only that page holds
 * the state to do it.
 */
export function RequestorShell({
  active,
  children,
  className,
}: RequestorShellProps) {
  return (
    <>
      <RequestorHeader active={active} />
      <main className={cn("flex-1", className)}>{children}</main>
    </>
  );
}
