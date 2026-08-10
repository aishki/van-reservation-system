"use client";

import { animate, stagger } from "motion";
import { useCallback, useRef } from "react";
import { flushSync } from "react-dom";

/** Outgoing sweep, ms. */
const OUT_MS = 520;
/** Van's return drive, ms — also how long the control stays busy. */
const BACK_MS = 720;

const EASE_IN = [0.5, 0.05, 0.7, 0.2] as const;
const EASE_OUT = [0.2, 0.9, 0.25, 1] as const;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * The hero's "drive-by wipe": the van drives forward (right→left), sweeping the
 * outgoing copy away with it; the incoming block is swapped in behind it and the
 * van drives back to its resting placement.
 *
 * Three deliberate departures from the design document's implementation:
 *
 * 1. **It does not gate on the van.** The design bails to an instant swap when
 *    `heroVanRef` is null — which, until the van photograph can be committed,
 *    is every single time, so the choreography would never once run. The van is
 *    animated only if it is actually mounted; the copy sweep runs regardless,
 *    and reads correctly on its own against the gradient field.
 *
 * 2. **It honours `prefers-reduced-motion`.** The design has no reduced-motion
 *    path. A 1.24-second sequence of blur, translation and opacity across a
 *    full-bleed hero is exactly what that preference exists to suppress, so
 *    under it the swap is immediate.
 *
 * 3. **A swap requested mid-flight is applied immediately rather than dropped.**
 *    The design returns early while busy, which silently discards a nav click
 *    for up to 1.24s. The state change always lands; only the animation is
 *    skipped.
 *
 * The DOM handoff uses `flushSync` rather than the design's double
 * `requestAnimationFrame`: it guarantees the incoming node exists before we read
 * its children, and because the swap and the first `animate` call sit in one
 * synchronous block, the browser never paints the incoming block at full opacity
 * before the entrance keyframes are applied. The double-rAF approach can flash.
 */
export function useHeroSwap() {
  const copyRef = useRef<HTMLDivElement | null>(null);
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const vanRef = useRef<HTMLImageElement | null>(null);
  const busy = useRef(false);

  const swapWith = useCallback(async (swap: () => void) => {
    if (busy.current || prefersReducedMotion()) {
      swap();
      return;
    }

    busy.current = true;
    try {
      const outgoing = copyRef.current ?? pickerRef.current;
      if (outgoing) {
        animate(
          outgoing,
          { opacity: [1, 0], x: [0, -70], filter: ["blur(0px)", "blur(8px)"] },
          { duration: OUT_MS / 1000, ease: EASE_IN },
        );
      }
      if (vanRef.current) {
        animate(
          vanRef.current,
          { x: [0, "-125%"] },
          { duration: OUT_MS / 1000, ease: EASE_IN },
        );
      }

      // Land the swap just before the sweep finishes, so the incoming block is
      // already moving as the outgoing one clears — the two overlap by 40ms.
      await wait(OUT_MS - 40);

      // Synchronous from here to the last `animate` call: no paint in between.
      flushSync(swap);

      const incoming = pickerRef.current ?? copyRef.current;
      if (incoming) {
        animate(
          incoming,
          { opacity: [0, 1] },
          { duration: 0.3, ease: "linear" },
        );
        animate(
          Array.from(incoming.children),
          // No `filter` blur-in here: the ride picker's glass cards use
          // backdrop-blur, and an animated filter on their ancestor re-roots
          // what the glass samples — the backdrop visibly snaps when the
          // animation ends. Opacity and y read nearly the same and stay
          // stable. The OUTGOING sweep keeps its blur: it runs on the block
          // that is disappearing, where a backdrop snap has nothing to show.
          { opacity: [0, 1], y: [22, 0] },
          { duration: 0.5, delay: stagger(0.07), ease: EASE_OUT },
        );
      }
      if (vanRef.current) {
        animate(
          vanRef.current,
          { x: ["34%", "0%"] },
          { duration: BACK_MS / 1000, ease: EASE_OUT },
        );
      }

      await wait(BACK_MS);
    } finally {
      busy.current = false;
    }
  }, []);

  return { copyRef, pickerRef, vanRef, swapWith };
}
