"use client";

import { useMutation } from "@tanstack/react-query";
import { motion, useReducedMotion } from "motion/react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { DomainIdInput } from "@/components/auth/domain-id-input";
import { LOGIN_ACCENT, type LoginVariant } from "@/components/auth/login-theme";
import { PasswordField } from "@/components/auth/password-field";
import { Button } from "@/components/ui/button";
import { ApiError, apiFetch } from "@/lib/api-fetcher";
import { cn } from "@/lib/utils";

interface LoginResponse {
  user: { role: "associate" | "admin_support" };
  redirectTo: string;
}

interface VerifyResponse {
  exists: boolean;
}

// Load-in: the blocks fade up in sequence as the van drives in beside them.
// Same settle ease as the van (see login-van.tsx).
const EASE_OUT = [0.2, 0.9, 0.25, 1] as const;
const loadContainer = {
  hidden: {},
  show: { transition: { staggerChildren: 0.1, delayChildren: 0.08 } },
};
const loadItem = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: EASE_OUT } },
};

export function LoginForm({ variant }: { variant: LoginVariant }) {
  const router = useRouter();
  const accent = LOGIN_ACCENT[variant];
  const reduce = useReducedMotion();
  // Under prefers-reduced-motion the load-in is dropped: the blocks render in
  // place with no fade or slide, matching the van's reduced-motion path.
  const loadIn = reduce
    ? {}
    : { initial: "hidden" as const, animate: "show" as const };
  const itemVariants = reduce ? undefined : loadItem;
  const [domainId, setDomainId] = useState("");
  const [password, setPassword] = useState("");
  // The password step is revealed only after the Domain ID is confirmed to
  // belong to an active associate (`verify` below).
  const [revealed, setRevealed] = useState(false);
  const [idError, setIdError] = useState<string | null>(null);

  const verify = useMutation({
    mutationFn: () =>
      apiFetch<VerifyResponse>("/api/auth/verify-domain", {
        method: "POST",
        body: JSON.stringify({ domainId }),
      }),
    onSuccess: (data) => {
      if (data.exists) {
        setIdError(null);
        setRevealed(true);
        return;
      }
      // A non-existent ID comes back as a normal 200 — surface it inline at the
      // field, not as a transient toast.
      setIdError("We couldn't find that Domain ID. Check it and try again.");
    },
    // Rate limit / outage (RATE_LIMITED, SERVICE_UNAVAILABLE) carry their own
    // message from the server; a missing ID never reaches here.
    onError: (error) =>
      toast.error(
        error instanceof ApiError
          ? error.message
          : "Couldn't check that Domain ID. Try again.",
      ),
  });

  const login = useMutation({
    // Body is { domainId, password, portal }. In cgsauth mode the server
    // verifies the password against the CGS Associate Authentication API; in
    // stub mode it is ignored and the Domain ID alone selects a fixture
    // identity.
    //
    // `portal` is the variant, so which page you signed in on decides whether
    // the admin whitelist is consulted at all: a whitelisted Domain ID at
    // /login is an associate. The server still re-derives the role from the
    // whitelist for the admin door — this field widens nothing, it only names
    // which door was used.
    mutationFn: () =>
      apiFetch<LoginResponse>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ domainId, password, portal: variant }),
      }),
    // The redirect target comes from the server's response, never from
    // which login page was used or any client-side role inference.
    onSuccess: (data) => router.push(data.redirectTo),
    onError: (error) =>
      toast.error(
        error instanceof ApiError ? error.message : "Sign-in failed.",
      ),
  });

  // Move focus to the password the moment it is revealed, so the flow continues
  // without a manual click.
  useEffect(() => {
    if (revealed) document.getElementById("password")?.focus();
  }, [revealed]);

  function handleDomainChange(value: string) {
    setDomainId(value);
    setIdError(null);
    // Editing the ID invalidates a prior verification — collapse the password
    // step so a changed ID cannot be signed in against a stale check.
    if (revealed) {
      setRevealed(false);
      setPassword("");
    }
  }

  const pending = verify.isPending || login.isPending;

  return (
    <motion.div
      className="flex w-full max-w-[460px] flex-col"
      variants={reduce ? undefined : loadContainer}
      {...loadIn}
    >
      {/* Partner lockups, pinned to the top of the form as in the design. */}
      <motion.div
        className="mb-14 flex items-center gap-6"
        variants={itemVariants}
      >
        <Image
          src="/figma/carelon-global-solutions-logo.png"
          alt="Carelon Global Solutions"
          width={2486}
          height={647}
          className="h-[30px] w-auto"
        />
        <Image
          src="/figma/ops-support-logo.png"
          alt="OPS Support"
          width={240}
          height={135}
          className="h-[26px] w-auto"
        />
        <Image
          src="/figma/business-intelligence-transformation-solutions-logo.png"
          alt="Business Intelligence & Transformation Solutions"
          width={240}
          height={135}
          className="h-[30px] w-auto"
        />
      </motion.div>

      <motion.div className="mb-8" variants={itemVariants}>
        <h1
          className={cn(
            "mb-3.5 text-[2.75rem] leading-[1.04] font-medium tracking-[-0.04em]",
            accent.heading,
          )}
        >
          Sign in
        </h1>
        <p className="max-w-[40ch] text-base text-pretty text-gray-2">
          Use the same credentials as your CGS One App account.
        </p>
      </motion.div>

      <motion.form
        className="flex flex-col gap-6"
        variants={itemVariants}
        onSubmit={(event) => {
          event.preventDefault();
          if (revealed) login.mutate();
          else verify.mutate();
        }}
      >
        <div className="flex flex-col gap-3">
          <DomainIdInput
            id="domainId"
            value={domainId}
            onChange={handleDomainChange}
            accent={accent}
            disabled={pending}
          />
          {idError && (
            <p
              role="alert"
              className="rounded-[0.75rem] border border-error-tint-border bg-error-tint px-4 py-3 text-[0.9375rem] text-error"
            >
              {idError}
            </p>
          )}
        </div>

        {/* Two-step reveal: the password animates up into place once the
            Domain ID is confirmed. The grid-rows 0fr→1fr transition animates
            height without a hard-coded max-height; the inner translate-y +
            opacity give the upward fade. Kept mounted (not conditionally
            rendered) so the transition can run; the input is disabled and the
            region hidden from assistive tech while collapsed. */}
        <div
          aria-hidden={!revealed}
          className={cn(
            "grid transition-all duration-300 ease-out motion-reduce:transition-none",
            revealed
              ? "translate-y-0 grid-rows-[1fr] opacity-100"
              : "-translate-y-1 grid-rows-[0fr] opacity-0",
          )}
        >
          <div className="overflow-hidden">
            <PasswordField
              id="password"
              value={password}
              onChange={setPassword}
              accent={accent}
              disabled={!revealed || login.isPending}
            />
          </div>
        </div>

        <Button
          type="submit"
          disabled={pending}
          className={cn(
            "h-auto w-full gap-2.5 rounded-pill py-[18px] text-[1.0625rem] font-semibold text-white shadow-[0_10px_26px_color-mix(in_srgb,var(--color-hero-base)_22%,transparent)] hover:-translate-y-0.5",
            accent.button,
          )}
        >
          {pending && (
            <span
              aria-hidden="true"
              className="size-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
            />
          )}
          {revealed
            ? login.isPending
              ? "Signing in…"
              : "Sign in"
            : verify.isPending
              ? "Checking…"
              : "Continue"}
        </Button>
      </motion.form>

      <motion.p
        className="mt-[22px] text-sm text-pretty text-gray-3"
        variants={itemVariants}
      >
        Can't sign in? Contact{" "}
        <span className="font-medium text-brand">OPS Support</span>. Access is
        limited to associates in Iloilo and Manila.
      </motion.p>
    </motion.div>
  );
}
