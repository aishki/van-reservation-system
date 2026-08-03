"use client";

import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { Toaster as Sonner, type ToasterProps } from "sonner";

// Hardcoded, not read from a prop or `useTheme()`: this is the light-only
// design's last line of defense. `providers.tsx` already passes
// `theme="light"`, but a second `<Toaster />` anywhere, or a future edit that
// drops that prop, would otherwise fall through to `useTheme()`'s "system"
// default and re-arm `prefers-color-scheme`.
const Toaster = ({ theme: _theme, ...props }: ToasterProps) => {
  // `theme` is destructured out and discarded above rather than spread back
  // in below, so a caller-supplied `theme` prop cannot win over this literal.
  return (
    <Sonner
      theme="light"
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
