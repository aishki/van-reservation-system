"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { ApiError, apiFetch } from "@/lib/api-fetcher";

export function SignOutButton() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);

  return (
    <button
      type="button"
      disabled={pending}
      onClick={async () => {
        setPending(true);
        try {
          // Order matters: only clear cached data and navigate once the
          // server has actually cleared the session. On rejection, the catch
          // below reports it and both stay in place, so the user is not left
          // thinking they signed out when the request failed.
          await apiFetch("/api/auth/logout", { method: "POST" });
          queryClient.clear();
          router.replace("/login");
        } catch (error) {
          toast.error(
            error instanceof ApiError ? error.message : "Sign-out failed.",
          );
        } finally {
          setPending(false);
        }
      }}
      className="text-sm text-primary hover:text-brand disabled:text-gray-3"
    >
      {pending ? "Signing out…" : "Sign out"}
    </button>
  );
}
