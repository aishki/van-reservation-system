// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("motion", () => ({ animate: vi.fn(), stagger: vi.fn(() => 0) }));

vi.mock("@/components/auth/sign-out-button", () => ({
  SignOutButton: () => <button type="button">Sign out</button>,
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: { href: string; children: React.ReactNode } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("next/image", () => ({
  default: ({ src, alt }: { src: string; alt: string }) => (
    // biome-ignore lint/performance/noImgElement: test stub standing in for next/image
    <img src={src} alt={alt} />
  ),
}));

const { HomeView } = await import("@/components/requestor/home-view");

beforeEach(() => {
  // Every test runs under reduced motion, which makes `swapWith` synchronous.
  // The choreography itself is covered by use-hero-swap.test.ts; these tests
  // are about which block is on screen, and pinning that through a 1.24s
  // animation would only make them slow and flaky.
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("prefers-reduced-motion"),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const headline = () => screen.queryByText(/Helping associates/);
const picker = () =>
  screen.queryByRole("heading", { name: "What do you need?" });

describe("HomeView", () => {
  it("opens on the resting hero", () => {
    render(<HomeView initialView="hero" />);

    expect(headline()).toBeTruthy();
    expect(picker()).toBeNull();
  });

  // `/?view=choose` is the only way the header's Book item can reach the picker
  // from another route, so this is a real entry point, not a convenience.
  it("honours ?view=choose by opening straight into the picker", () => {
    render(<HomeView initialView="choose" />);

    expect(picker()).toBeTruthy();
    expect(headline()).toBeNull();
  });

  it("swaps to the picker from the hero CTA", () => {
    render(<HomeView initialView="hero" />);

    fireEvent.click(screen.getByRole("button", { name: "Book a trip" }));

    expect(picker()).toBeTruthy();
    expect(headline()).toBeNull();
  });

  it("swaps to the picker from the header's Book item", () => {
    render(<HomeView initialView="hero" />);

    fireEvent.click(screen.getAllByRole("button", { name: "Book" })[0]);

    expect(picker()).toBeTruthy();
  });

  it("returns to the resting hero from the picker's Back control", () => {
    render(<HomeView initialView="choose" />);

    fireEvent.click(screen.getByRole("button", { name: /Back/ }));

    expect(headline()).toBeTruthy();
    expect(picker()).toBeNull();
  });

  it("returns to the resting hero from the header's Home button while the picker is open", () => {
    render(<HomeView initialView="choose" />);

    fireEvent.click(screen.getAllByRole("button", { name: "Home" })[0]);

    expect(headline()).toBeTruthy();
    expect(picker()).toBeNull();
  });

  it("is a no-op clicking Home while already resting on the hero", () => {
    render(<HomeView initialView="hero" />);

    fireEvent.click(screen.getAllByRole("button", { name: "Home" })[0]);

    // Same resting copy still on screen — no swap was replayed onto itself.
    expect(headline()).toBeTruthy();
    expect(picker()).toBeNull();
  });

  it("moves the header's current marker to Book while choosing", () => {
    render(<HomeView initialView="choose" />);

    for (const el of screen.getAllByRole("button", { name: "Book" })) {
      expect(el.className).toMatch(/font-bold|bg-brand/);
    }
    for (const el of screen.getAllByRole("button", { name: "Home" })) {
      expect(el.className).not.toMatch(/font-bold/);
    }
  });

  it("offers both ride modes as links carrying the chosen mode", () => {
    render(<HomeView initialView="choose" />);

    expect(
      screen
        .getByRole("link", { name: /Pickup \/ Drop-Off/ })
        .getAttribute("href"),
    ).toBe("/book?mode=pickup");
    expect(
      screen.getByRole("link", { name: /Standby Van/ }).getAttribute("href"),
    ).toBe("/book?mode=standby");
  });

  it("derives the hero metadata from the domain rather than hard-coded copy", () => {
    render(<HomeView initialView="hero" />);

    // The design ships these as literal strings. Pinning them to the domain
    // vocabulary is what stops the row going stale when a third site opens.
    expect(screen.getByText("Iloilo · Manila")).toBeTruthy();
    expect(screen.getByText("Pickup / drop-off · Standby")).toBeTruthy();
  });

  describe("the landing page is exactly one viewport", () => {
    it("clips to the dynamic viewport height rather than 100vh", () => {
      const { container } = render(<HomeView initialView="hero" />);
      const root = container.firstElementChild;

      // h-screen would overflow by the height of a mobile URL bar, which is the
      // one place a deliberately non-scrolling page visibly fails.
      expect(root?.className).toMatch(/\bh-dvh\b/);
      expect(root?.className).toMatch(/\boverflow-hidden\b/);
      expect(root?.className).not.toMatch(/\bh-screen\b/);
    });

    it("gives the hero the leftover height instead of a hard-coded offset", () => {
      render(<HomeView initialView="hero" />);
      // The header is taller on mobile (it carries a second row of nav pills),
      // so any calc(100vh - Npx) on the hero is wrong at one breakpoint.
      const hero = document.querySelector("main");
      expect(hero?.className).toMatch(/\bflex-1\b/);
      expect(hero?.className ?? "").not.toMatch(/calc\(100/);
    });

    it("renders nothing below the hero", () => {
      render(<HomeView initialView="hero" />);

      // The index strip and the closing panel were removed; a scroll region
      // reappearing under the hero means one of them came back.
      const root = document.querySelector("div.h-dvh");
      expect(root?.children).toHaveLength(2); // header + hero, nothing else
      expect(screen.queryByText(/Two ways/)).toBeNull();
      expect(screen.queryByText(/After you book/)).toBeNull();
      expect(screen.queryByText(/Pick the one that matches/)).toBeNull();
    });
  });
});
