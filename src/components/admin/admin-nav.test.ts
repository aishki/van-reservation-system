import { describe, expect, it } from "vitest";
import { ADMIN_NAV, initialsFor } from "@/components/admin/admin-nav";

describe("initialsFor", () => {
  // The design's own sample data and the booking form both use "Last, First".
  it.each([
    ["Jimera, Arielle", "AJ"],
    ["Abanto, Norlyn", "NA"],
    ["Dela Cruz, Juan", "JD"],
    ["  Cruz , Ivan  ", "IC"],
  ])('reads "%s" as %s, given name first', (name, expected) => {
    expect(initialsFor(name)).toBe(expected);
  });

  // The dev identity fixtures — and probably the real auth API — use "First
  // Last". Handling only the comma form gave every one of these a single letter.
  it.each([
    ["Ivy Balandra", "IB"],
    ["Juan Dela Cruz", "JC"],
    ["Arielle Jimera", "AJ"],
  ])('reads "%s" as %s', (name, expected) => {
    expect(initialsFor(name)).toBe(expected);
  });

  it("gives the same monogram for both spellings of one name", () => {
    expect(initialsFor("Jimera, Arielle")).toBe(initialsFor("Arielle Jimera"));
  });

  it.each([
    ["a single word", "Madonna", "MM"],
    ["empty", "", "?"],
    ["whitespace only", "   ", "?"],
    ["a lone comma", ",", "?"],
  ])("handles %s", (_label, name, expected) => {
    expect(initialsFor(name)).toBe(expected);
  });

  it("always upper-cases", () => {
    expect(initialsFor("dela cruz, juan")).toBe("JD");
  });
});

describe("ADMIN_NAV", () => {
  it("has a unique key, href, label and title for every entry", () => {
    expect(new Set(ADMIN_NAV.map((i) => i.key)).size).toBe(ADMIN_NAV.length);
    expect(new Set(ADMIN_NAV.map((i) => i.href)).size).toBe(ADMIN_NAV.length);
    for (const item of ADMIN_NAV) {
      expect(item.label.trim()).not.toBe("");
      expect(item.title.trim()).not.toBe("");
      // Defined, not "a function": lucide ships `forwardRef` components, which
      // are objects. An absent icon would render nothing and leave the nav item
      // visually misaligned with its neighbours, so presence is what matters.
      expect(item.Icon).toBeTruthy();
    }
  });

  it("derives each href from its key", () => {
    // The middleware gates on the href; the sidebar highlights on the key. If
    // they diverge, a route is either ungated or never shows as current.
    for (const item of ADMIN_NAV) {
      expect(item.href).toBe(`/${item.key}`);
    }
  });

  // The sidebar label and the topbar title are allowed to differ — the design
  // shows "Report Generation" in the nav and "Reports" as the heading — so this
  // pins that the difference is intentional rather than a typo in one of them.
  it("keeps the one deliberate label/title mismatch", () => {
    const mismatches = ADMIN_NAV.filter((i) => i.label !== i.title).map(
      (i) => i.key,
    );
    expect(mismatches).toEqual(["reports"]);
  });
});
