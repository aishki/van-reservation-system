"use client";

import { useState } from "react";
import { HeroCopy } from "@/components/requestor/hero-copy";
import { HeroMeta } from "@/components/requestor/hero-meta";
import { HeroRidePicker } from "@/components/requestor/hero-ride-picker";
import { HeroShell } from "@/components/requestor/hero-shell";
import { RequestorHeader } from "@/components/requestor/requestor-header";
import { useHeroSwap } from "@/hooks/use-hero-swap";

export type HomeHeroView = "hero" | "choose";

interface HomeViewProps {
  /** Read from `?view=choose` so the header's "Book" item can reach the picker
   *  from another route. Not kept in sync afterwards — see `HeroRidePicker`. */
  initialView: HomeHeroView;
}

/**
 * Owns the one piece of state the landing surface has: whether the hero shows
 * its resting copy or the ride picker. Everything below it is presentational.
 *
 * The landing page is exactly one viewport tall and does not scroll. That is
 * achieved with a flex column rather than putting a height on the hero itself:
 * the header is 64px on desktop but taller on mobile, where it carries a second
 * row of nav pills, so any `calc(100vh - Npx)` would be wrong at one breakpoint
 * or the other. `flex-1` on the hero just takes whatever is left.
 *
 * `h-dvh` rather than `h-screen`: on mobile browsers `100vh` measures the
 * viewport with the URL bar hidden, so a `h-screen` hero overflows by the height
 * of that bar and the page scrolls when it is meant not to.
 */
export function HomeView({ initialView }: HomeViewProps) {
  const [view, setView] = useState<HomeHeroView>(initialView);
  const { copyRef, pickerRef, vanRef, swapWith } = useHeroSwap();

  const chooseRide = () => swapWith(() => setView("choose"));

  const goHome = () => {
    // No-op while already resting — replaying the sweep to land on the same
    // copy would read as a glitch, not a navigation.
    if (view !== "hero") swapWith(() => setView("hero"));
  };

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <RequestorHeader
        active={view === "choose" ? "book" : "home"}
        onChooseRide={chooseRide}
        onGoHome={goHome}
      />
      <HeroShell meta={<HeroMeta />} vanRef={vanRef}>
        {view === "hero" ? (
          <HeroCopy ref={copyRef} onBookTrip={chooseRide} />
        ) : (
          <HeroRidePicker
            ref={pickerRef}
            onBack={() => swapWith(() => setView("hero"))}
          />
        )}
      </HeroShell>
    </div>
  );
}
