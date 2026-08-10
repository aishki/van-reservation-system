// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { HeroShell } from "@/components/requestor/hero-shell";

afterEach(() => {
  cleanup();
});

// next/image is deliberately NOT mocked in this file. The whole point of these
// tests is that the real component forwards a ref and emits the attributes the
// hero depends on — a stub would assert only that the stub behaves.
describe("HeroShell", () => {
  it("forwards vanRef to a real image element", () => {
    const vanRef = createRef<HTMLImageElement>();
    render(
      <HeroShell meta={null} vanRef={vanRef}>
        {null}
      </HeroShell>,
    );

    // If next/image ever stops forwarding refs, `vanRef.current` stays null and
    // `useHeroSwap` silently skips the van for the rest of the app's life —
    // no error, no visual clue beyond a van that never moves. That is exactly
    // the failure the design document shipped, so it gets a test.
    expect(vanRef.current).toBeInstanceOf(HTMLImageElement);
  });

  it("renders the van as decoration, not content", () => {
    render(<HeroShell meta={null}>{null}</HeroShell>);

    // An empty alt plus aria-hidden keeps it out of the accessibility tree;
    // a screen reader has nothing useful to say about a background photograph.
    const van = document.querySelector('img[aria-hidden="true"]');
    expect(van).not.toBeNull();
    expect(van?.getAttribute("alt")).toBe("");
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("points the van at the committed asset", () => {
    render(<HeroShell meta={null}>{null}</HeroShell>);

    // Next rewrites src through /_next/image?url=…, so assert on the encoded
    // original rather than an exact string.
    const van = document.querySelector('img[aria-hidden="true"]');
    expect(van?.getAttribute("src")).toMatch(
      /van-side-full\.png|van-side-full%2Fpng|%2Fassets%2Fvan-side-full\.png/,
    );
  });

  it("keeps the van unclamped so it can bleed past the container", () => {
    render(<HeroShell meta={null}>{null}</HeroShell>);
    const van = document.querySelector('img[aria-hidden="true"]');

    // Without max-w-none the global img max-width clamps the van to its
    // container and the right-edge bleed — the composition's whole point —
    // silently disappears. h-auto is what preserves aspect once width is
    // CSS-driven rather than attribute-driven.
    expect(van?.className).toMatch(/\bmax-w-none\b/);
    expect(van?.className).toMatch(/\bh-auto\b/);
    expect(van?.className).toMatch(/\bhero-van-mask\b/);
  });

  it("renders its children and metadata slots", () => {
    render(
      <HeroShell meta={<p>meta slot</p>}>
        <p>content slot</p>
      </HeroShell>,
    );

    expect(screen.getByText("content slot")).toBeTruthy();
    expect(screen.getByText("meta slot")).toBeTruthy();
  });

  it("stacks the van below the scrim and the scrim below the content", () => {
    const { container } = render(
      <HeroShell meta={null}>
        <p>content slot</p>
      </HeroShell>,
    );

    // The design leaves the copy at z-index auto with the van at 2 and the
    // scrim at 3, which per CSS paints both decorative layers OVER the
    // headline. This pins the corrected order instead.
    const van = document.querySelector('img[aria-hidden="true"]');
    const scrim = container.querySelector('[class*="to-hero-scrim"]');
    const content = screen.getByText("content slot").parentElement;

    expect(van?.className).toMatch(/\bz-10\b/);
    expect(scrim?.className).toMatch(/\bz-20\b/);
    expect(content?.className).toMatch(/\bz-30\b/);
  });
});
