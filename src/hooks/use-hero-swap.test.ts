// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const animate = vi.fn();
const stagger = vi.fn((_gap: number) => 0);

vi.mock("motion", () => ({
  animate: (...args: unknown[]) => animate(...args),
  stagger: (gap: number) => stagger(gap),
}));

const { useHeroSwap } = await import("@/hooks/use-hero-swap");

/** jsdom ships no matchMedia, so every test states the preference explicitly. */
function setReducedMotion(reduce: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: reduce && query.includes("prefers-reduced-motion"),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  animate.mockClear();
  stagger.mockClear();
});

describe("useHeroSwap under prefers-reduced-motion: reduce", () => {
  beforeEach(() => setReducedMotion(true));

  // This is the whole point of the reduced-motion path: the state change must
  // still happen, and no animation may run. A version that skipped the swap
  // would leave the hero stuck; one that still animated would ignore the
  // preference. Both are pinned here.
  it("applies the swap and runs no animation", async () => {
    const { result } = renderHook(() => useHeroSwap());
    const swap = vi.fn();

    await act(async () => {
      await result.current.swapWith(swap);
    });

    expect(swap).toHaveBeenCalledTimes(1);
    expect(animate).not.toHaveBeenCalled();
  });

  it("resolves immediately rather than waiting out the sequence", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useHeroSwap());
    const swap = vi.fn();

    // No timer is advanced. If the reduced-motion branch fell through to the
    // animated path this would never settle, because that path awaits 480ms.
    await act(async () => {
      await result.current.swapWith(swap);
    });

    expect(swap).toHaveBeenCalledTimes(1);
  });
});

describe("useHeroSwap with motion allowed", () => {
  beforeEach(() => setReducedMotion(false));

  it("sweeps the outgoing block out before applying the swap", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useHeroSwap());
    const swap = vi.fn();
    const outgoing = document.createElement("div");
    outgoing.appendChild(document.createElement("p"));
    result.current.copyRef.current = outgoing;

    let settled = false;
    await act(async () => {
      result.current.swapWith(swap).then(() => {
        settled = true;
      });
    });

    // The exit animation is already running, but the DOM has not swapped yet —
    // if `swap` had been called synchronously the outgoing block would vanish
    // before it could animate at all.
    expect(animate).toHaveBeenCalled();
    expect(swap).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(480);
    });
    expect(swap).toHaveBeenCalledTimes(1);

    expect(settled).toBe(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(720);
    });
    expect(settled).toBe(true);
  });

  it("animates the copy block even with no van mounted", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useHeroSwap());
    const outgoing = document.createElement("div");
    result.current.copyRef.current = outgoing;
    // vanRef stays null. The photograph IS committed now and
    // hero-shell.test.tsx pins that its ref reaches a real element — but this
    // remains the guard that matters: the design's own implementation bails to
    // an instant swap when the van is missing, so if the asset is ever pulled
    // or a Next upgrade stops forwarding refs, its choreography degrades to
    // nothing at all. Ours must still sweep the copy.
    expect(result.current.vanRef.current).toBeNull();

    await act(async () => {
      result.current.swapWith(vi.fn());
    });

    expect(animate).toHaveBeenCalledTimes(1);
    expect(animate.mock.calls[0][0]).toBe(outgoing);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1200);
    });
  });

  it("staggers the incoming block's children once it has mounted", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useHeroSwap());
    const incoming = document.createElement("div");
    incoming.append(
      document.createElement("p"),
      document.createElement("h2"),
      document.createElement("div"),
    );

    await act(async () => {
      // The swap is what mounts the picker, so the ref is set inside it —
      // mirroring how React makes the node available only after the update.
      result.current.swapWith(() => {
        result.current.pickerRef.current = incoming;
      });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(480);
    });

    const staggered = animate.mock.calls.find((call) => Array.isArray(call[0]));
    expect(staggered).toBeDefined();
    expect(staggered?.[0]).toHaveLength(3);
    // No `filter` keyframes on the children: an animated ancestor filter
    // re-roots the ride-picker cards' backdrop-blur, and the glass visibly
    // jumps when the animation completes (worst over the van photo).
    expect(staggered?.[1]).not.toHaveProperty("filter");
    expect(stagger).toHaveBeenCalledWith(0.07);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(720);
    });
  });

  it("applies a swap requested mid-flight instead of dropping it", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useHeroSwap());
    result.current.copyRef.current = document.createElement("div");

    await act(async () => {
      result.current.swapWith(vi.fn());
    });

    // The design returns early while busy, silently discarding this click for
    // up to 1.24s. Ours must still land the state change.
    const second = vi.fn();
    await act(async () => {
      await result.current.swapWith(second);
    });
    expect(second).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1200);
    });
  });
});
