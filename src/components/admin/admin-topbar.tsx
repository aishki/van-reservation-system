"use client";

import { Bell } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { initialsFor } from "@/components/admin/admin-nav";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { useDismissable } from "@/hooks/use-dismissable";

interface AdminTopbarProps {
  title: string;
  userName: string;
}

/**
 * Page title on the left, notifications and the account menu on the right.
 *
 * The design puts the page title in an `h1` here, which makes the topbar the
 * owner of every admin page's single top-level heading. That is kept: it means
 * each screen's own content starts at `h2` and the heading order never depends on
 * which surface is mounted.
 *
 * The bell is deliberately inert and says so when pressed. Notifications are a
 * real part of the process (the whitelist's site membership exists to route
 * them), but nothing generates any yet, and a bell that silently does nothing
 * reads as broken. The design shows an unread dot; showing one with no
 * notifications behind it would be a lie, so it is only rendered when there is
 * something to report — currently never.
 */
export function AdminTopbar({ title, userName }: AdminTopbarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => {
    setMenuOpen(false);
    triggerRef.current?.focus();
  }, []);
  useDismissable(menuOpen, menuRootRef, close);

  const unreadCount = 0;

  return (
    <header className="sticky top-0 z-30 flex items-center gap-5 border-b border-gray-6 bg-background px-6 py-[22px] md:px-10">
      <h1 className="text-h3 leading-[3rem] font-normal tracking-[-0.01em] text-gray-1">
        {title}
      </h1>

      <div className="ml-auto flex items-center gap-[18px]">
        <button
          type="button"
          onClick={() =>
            toast("Notifications aren't wired up yet.", {
              description:
                "Approval alerts arrive with the notification slice.",
            })
          }
          aria-label={
            unreadCount === 0
              ? "Notifications, none unread"
              : `Notifications, ${unreadCount} unread`
          }
          className="relative flex size-11 cursor-pointer items-center justify-center rounded-pill border-0 bg-gray-5 text-brand hover:bg-gray-6 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          <Bell aria-hidden="true" className="size-5" />
          {unreadCount > 0 && (
            <span
              aria-hidden="true"
              className="absolute top-2 right-[9px] size-[9px] rounded-pill bg-error"
            />
          )}
        </button>

        <div ref={menuRootRef} className="relative">
          <button
            ref={triggerRef}
            type="button"
            // A disclosure, not an ARIA `menu`. The panel holds one action, and
            // `role="menu"` would promise arrow-key navigation between items
            // that do not exist — while forcing every child to be a focusable
            // `menuitem`, which is what made the wrapper below invalid.
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((current) => !current)}
            className="flex cursor-pointer items-center gap-3 border-0 bg-transparent p-1.5 hover:opacity-85 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            <span
              aria-hidden="true"
              className="flex size-9 items-center justify-center rounded-pill bg-gray-6 text-sm font-semibold text-gray-2"
            >
              {initialsFor(userName)}
            </span>
            <span className="text-lg text-gray-1">{userName}</span>
            <span aria-hidden="true" className="text-[0.7rem] text-gray-3">
              ▾
            </span>
          </button>

          {menuOpen && (
            <div className="absolute top-[52px] right-0 z-40 w-[220px] animate-in fade-in slide-in-from-top-1 rounded-field border border-gray-6 bg-popover py-1.5 shadow-[0_14px_34px_color-mix(in_srgb,var(--color-navy)_16%,transparent)] duration-100">
              {/* The design reads "Admin Support · Manila". The site half is
                  omitted: it is not on the session, and Admin Support is one flat
                  role whose whitelist site only routes notifications — printing a
                  site here would imply a scope boundary that does not exist. */}
              <p className="px-[18px] pt-3 pb-2 text-xs text-gray-2">
                Admin Support
              </p>
              <div className="px-[18px] py-3">
                <SignOutButton />
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
