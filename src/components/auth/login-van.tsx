"use client";

import { motion, useReducedMotion } from "motion/react";
import Image from "next/image";

// Matches the hero's drive ease (see use-hero-swap.ts's EASE_OUT): a quick
// pull-away that settles gently, so the van reads as coasting to a stop.
const DRIVE_EASE = [0.2, 0.9, 0.25, 1] as const;

/**
 * The van breaks past the diagonal wedge and, on first load, drives in from the
 * right to its resting placement — the same right→left forward motion the
 * portal hero uses (use-hero-swap.ts), here as a one-shot entrance.
 *
 * Decorative only: `aria-hidden` + empty `alt`, no pointer events. It carries
 * no information the sign-in copy does not, so announcing it would add noise.
 *
 * The transform lives on the wrapper, not the image, so `next/image` still
 * handles the raster (optimised, `priority` to avoid a pop-in) while motion
 * animates the wedge-relative slide. `w-[76%]`/`-right`/`-bottom` are read from
 * the Login design so the front pokes across the wedge; `max-w-none` defeats
 * the global `img` clamp that would otherwise kill the bleed.
 *
 * Under prefers-reduced-motion the drive is dropped entirely — the van simply
 * appears in place — consistent with the hero's reduced-motion path.
 */
export function LoginVan() {
  const reduce = useReducedMotion();

  const drive = reduce
    ? {}
    : {
        initial: { x: "72%", opacity: 0 },
        animate: { x: 0, opacity: 1 },
        transition: { duration: 1.1, ease: DRIVE_EASE, delay: 0.15 },
      };

  return (
    <motion.div
      aria-hidden="true"
      className="pointer-events-none absolute -right-[8%] -bottom-[11%] z-10 w-[76%] select-none"
      {...drive}
    >
      <Image
        src="/assets/van-side-full.png"
        alt=""
        aria-hidden="true"
        width={1734}
        height={787}
        priority
        sizes="(min-width: 1024px) 76vw, 0px"
        className="h-auto w-full max-w-none"
      />
    </motion.div>
  );
}
