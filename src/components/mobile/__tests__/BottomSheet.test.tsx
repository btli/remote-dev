/**
 * BottomSheet tests (Phase 2 mobile redesign).
 *
 * Covers:
 *   - The slide-up panel respects `prefers-reduced-motion` by setting a
 *     0ms transition duration instead of the default 240ms.
 *   - ESC closes the sheet via onOpenChange.
 *   - The overlay click closes the sheet.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

import { BottomSheet } from "@/components/mobile/common/BottomSheet";

let matchMediaImpl: (query: string) => MediaQueryList;

beforeEach(() => {
  matchMediaImpl = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }) as unknown as MediaQueryList;
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((q: string) => matchMediaImpl(q)),
  });
});

afterEach(() => cleanup());

describe("BottomSheet", () => {
  it("uses 0ms duration when prefers-reduced-motion is reduce", async () => {
    matchMediaImpl = (query: string) =>
      ({
        matches: query === "(prefers-reduced-motion: reduce)",
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }) as unknown as MediaQueryList;
    render(
      <BottomSheet open={true} onOpenChange={vi.fn()} ariaLabel="Test">
        <div>body</div>
      </BottomSheet>
    );
    await waitFor(() => screen.getByTestId("mobile-bottom-sheet"));
    const panel = screen.getByTestId("mobile-bottom-sheet");
    expect(panel.style.transitionDuration).toBe("0ms");
  });

  it("uses the iOS-style cubic-bezier easing at 240ms by default", async () => {
    render(
      <BottomSheet open={true} onOpenChange={vi.fn()} ariaLabel="Test">
        <div>body</div>
      </BottomSheet>
    );
    await waitFor(() => screen.getByTestId("mobile-bottom-sheet"));
    const panel = screen.getByTestId("mobile-bottom-sheet");
    expect(panel.style.transitionDuration).toBe("240ms");
    expect(panel.style.transitionTimingFunction).toContain("cubic-bezier");
  });

  it("calls onOpenChange(false) when ESC is pressed", async () => {
    const onOpenChange = vi.fn();
    render(
      <BottomSheet open={true} onOpenChange={onOpenChange} ariaLabel="Test">
        <div>body</div>
      </BottomSheet>
    );
    await waitFor(() => screen.getByTestId("mobile-bottom-sheet"));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("calls onOpenChange(false) when the overlay is clicked", async () => {
    const onOpenChange = vi.fn();
    render(
      <BottomSheet open={true} onOpenChange={onOpenChange} ariaLabel="Test">
        <div>body</div>
      </BottomSheet>
    );
    await waitFor(() => screen.getByLabelText("Close sheet"));
    fireEvent.click(screen.getByLabelText("Close sheet"));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
