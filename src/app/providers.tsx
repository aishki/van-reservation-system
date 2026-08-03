"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { makeQueryClient } from "@/lib/query-client";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(makeQueryClient);

  return (
    <QueryClientProvider client={queryClient}>
      {/* Without a provider every tooltip falls back to Base UI's 600ms open
          delay, which is a *rest* timer — the pointer must hold still for all
          of it. The provider also groups them, so moving between adjacent
          locked fields shows each hint immediately. */}
      <TooltipProvider delay={200} closeDelay={0}>
        {children}
      </TooltipProvider>
      {/* Pinned light: Sonner reads `useTheme()`, there is no ThemeProvider, so it
          falls through to "system" and resolves from prefers-color-scheme. */}
      <Toaster theme="light" />
    </QueryClientProvider>
  );
}
