// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const toast = vi.fn();
vi.mock("sonner", () => ({ toast: (...args: unknown[]) => toast(...args) }));

// Stubbed rather than mocking the four transitive dependencies SignOutButton
// pulls in (router, query client, api-fetcher, sonner). Its own behaviour is
// covered by sign-out-button.test.tsx; here it only needs to be present.
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
  default: ({
    src,
    alt,
    className,
    sizes,
  }: {
    src: string;
    alt: string;
    className?: string;
    sizes?: string;
  }) => (
    // biome-ignore lint/performance/noImgElement: test stub standing in for next/image
    <img src={src} alt={alt} className={className} sizes={sizes} />
  ),
}));

const { RequestorHeader } = await import(
  "@/components/requestor/requestor-header"
);

afterEach(() => {
  cleanup();
  toast.mockClear();
});

/** The desktop nav and the mobile pill rail both render every item, so every
 *  lookup here is plural by design — asserting a single match would be
 *  asserting that one of the two responsive navs is missing. */
function itemsNamed(name: string) {
  return [
    ...screen.queryAllByRole("link", { name }),
    ...screen.queryAllByRole("button", { name }),
  ];
}

describe("RequestorHeader", () => {
  it("renders all three partner lockups with accessible names", () => {
    render(<RequestorHeader active="home" />);

    for (const name of [
      "Carelon Global Solutions",
      "OPS Support",
      "Business Intelligence & Transformation Solutions",
    ]) {
      expect(screen.getByAltText(name)).toBeTruthy();
    }
  });

  it("gives the logos an explicit height so none renders at intrinsic size", () => {
    // carelon-global-solutions-logo.png is 2486px wide. Without a height class
    // it would render at that width and destroy the header.
    render(<RequestorHeader active="home" />);
    const logo = screen.getByAltText("Carelon Global Solutions");
    expect(logo.className).toMatch(/\bh-4\b/);
    expect(logo.className).toMatch(/\bw-auto\b/);
  });

  // Without `sizes`, Next derives its candidate set from the `width` prop, and
  // the Carelon mark's 2486px width collapses the srcset to a single 3840px
  // entry that then gets preloaded — an 85px-wide logo costing a full-resolution
  // fetch. The rendered page looks identical either way, so nothing but this
  // test stands between that regression and production.
  it.each([
    "Carelon Global Solutions",
    "OPS Support",
    "Business Intelligence & Transformation Solutions",
  ])("constrains %s with an explicit sizes attribute", (name) => {
    render(<RequestorHeader active="home" />);
    const sizes = screen.getByAltText(name).getAttribute("sizes");

    expect(sizes).toBeTruthy();
    // A bare `100vw` would defeat the point — these are fixed-width marks, so
    // the value has to be a small pixel measurement, not a viewport fraction.
    expect(sizes).toMatch(/^\(min-width: \d+px\) \d{2,3}px, \d{2,3}px$/);
  });

  it.each([
    ["home", "Home"],
    ["manage", "Manage"],
  ] as const)("marks %s as the current item", (active, label) => {
    render(<RequestorHeader active={active} />);
    for (const el of itemsNamed(label)) {
      expect(el.className).toMatch(/font-bold|bg-brand/);
    }
  });

  it("does not mark a non-current item", () => {
    render(<RequestorHeader active="home" />);
    for (const el of itemsNamed("Manage")) {
      expect(el.className).not.toMatch(/font-bold/);
    }
  });

  it("links Manage to its route", () => {
    render(<RequestorHeader active="home" />);
    for (const el of itemsNamed("Manage")) {
      expect(el.getAttribute("href")).toBe("/manage");
    }
  });

  describe("the Book item", () => {
    it("is a button that swaps in place when the page owns the hero", () => {
      const onChooseRide = vi.fn();
      render(<RequestorHeader active="home" onChooseRide={onChooseRide} />);

      const books = itemsNamed("Book");
      expect(books.length).toBeGreaterThan(0);
      for (const el of books) {
        expect(el.tagName).toBe("BUTTON");
        expect(el.getAttribute("href")).toBeNull();
      }

      fireEvent.click(books[0]);
      expect(onChooseRide).toHaveBeenCalledTimes(1);
    });

    // Without a handler there is no hero on this page to swap, so the item has
    // to navigate — and it has to land with the picker already open, or "Book"
    // would drop the user on the marketing hero and appear to do nothing.
    it("becomes a link that opens the picker when the page has no hero", () => {
      render(<RequestorHeader active="manage" />);
      for (const el of itemsNamed("Book")) {
        expect(el.tagName).toBe("A");
        expect(el.getAttribute("href")).toBe("/?view=choose");
      }
    });
  });

  it("says so out loud when About is pressed, rather than 404ing", () => {
    render(<RequestorHeader active="home" />);
    const about = itemsNamed("About");

    for (const el of about) {
      expect(el.tagName).toBe("BUTTON");
      expect(el.getAttribute("href")).toBeNull();
    }

    fireEvent.click(about[0]);
    expect(toast).toHaveBeenCalledWith("The About page isn't built yet.");
  });

  it("keeps a way to sign out, which the design's header omits", () => {
    render(<RequestorHeader active="home" />);
    expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();
  });

  describe("onGoHome", () => {
    it("renders Home as a button that calls onGoHome when supplied", () => {
      const onGoHome = vi.fn();
      render(
        <RequestorHeader
          active="book"
          onChooseRide={() => {}}
          onGoHome={onGoHome}
        />,
      );
      // Desktop nav and mobile rail each render one.
      const homeButtons = screen.getAllByRole("button", { name: "Home" });
      expect(homeButtons).toHaveLength(2);
      fireEvent.click(homeButtons[0]);
      expect(onGoHome).toHaveBeenCalledTimes(1);
    });

    it("renders Home as a link to / when onGoHome is absent", () => {
      render(<RequestorHeader active="manage" />);
      const homeLinks = screen.getAllByRole("link", { name: "Home" });
      expect(homeLinks.length).toBeGreaterThan(0);
      expect(homeLinks[0].getAttribute("href")).toBe("/");
    });
  });
});
