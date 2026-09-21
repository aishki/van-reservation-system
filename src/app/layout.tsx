import type { Metadata } from "next";
import { Providers } from "@/app/providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "Van Reservation System",
  description:
    "Reserve and manage company van transportation — Carelon Global Solutions PH",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="h-full antialiased">
      {/* Browser extensions inject classes and attributes onto <body> before
          React hydrates (e.g. `vc-init`), which is a mismatch the app did not
          cause. Suppression is one level deep: it covers this element's own
          attributes and does not hide mismatches in anything rendered inside. */}
      <body
        suppressHydrationWarning
        className="flex min-h-full flex-col bg-background text-foreground"
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
