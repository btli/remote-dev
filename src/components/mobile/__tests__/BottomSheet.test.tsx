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

  describe("focus trap", () => {
    it("moves focus to the first focusable element on enter", async () => {
      render(
        <BottomSheet open={true} onOpenChange={vi.fn()} ariaLabel="Test">
          <button type="button" data-testid="first-btn">first</button>
          <button type="button" data-testid="second-btn">second</button>
        </BottomSheet>
      );
      await waitFor(() => {
        expect(screen.getByTestId("first-btn")).toHaveFocus();
      });
    });

    it("Tab from the last focusable cycles to the first", async () => {
      render(
        <BottomSheet open={true} onOpenChange={vi.fn()} ariaLabel="Test">
          <button type="button" data-testid="first-btn">first</button>
          <button type="button" data-testid="second-btn">second</button>
        </BottomSheet>
      );
      // Wait for the focus-trap effect to install (gated on `entered`).
      await waitFor(() =>
        expect(screen.getByTestId("first-btn")).toHaveFocus()
      );
      const panel = screen.getByTestId("mobile-bottom-sheet");
      const second = screen.getByTestId("second-btn");
      second.focus();
      expect(second).toHaveFocus();
      // Tab from last → cycle to first.
      fireEvent.keyDown(panel, { key: "Tab" });
      expect(screen.getByTestId("first-btn")).toHaveFocus();
    });

    it("Shift+Tab from the first focusable cycles to the last", async () => {
      render(
        <BottomSheet open={true} onOpenChange={vi.fn()} ariaLabel="Test">
          <button type="button" data-testid="first-btn">first</button>
          <button type="button" data-testid="second-btn">second</button>
        </BottomSheet>
      );
      await waitFor(() =>
        expect(screen.getByTestId("first-btn")).toHaveFocus()
      );
      const panel = screen.getByTestId("mobile-bottom-sheet");
      const first = screen.getByTestId("first-btn");
      // first-btn is already focused from auto-focus above.
      expect(first).toHaveFocus();
      // Shift+Tab from first → cycle to last.
      fireEvent.keyDown(panel, { key: "Tab", shiftKey: true });
      expect(screen.getByTestId("second-btn")).toHaveFocus();
    });

    it("body scroll lock survives concurrent nested sheets (refcount)", async () => {
      const { rerender } = render(
        <>
          <BottomSheet open={true} onOpenChange={vi.fn()} ariaLabel="A">
            <div>a</div>
          </BottomSheet>
          <BottomSheet open={true} onOpenChange={vi.fn()} ariaLabel="B">
            <div>b</div>
          </BottomSheet>
        </>
      );
      await waitFor(() => screen.getAllByTestId("mobile-bottom-sheet"));
      // Both sheets open → body locked.
      expect(document.body.style.overflow).toBe("hidden");
      // Close the first sheet — body should still be locked because the
      // second sheet is still open. Naive save/restore would unlock here.
      rerender(
        <>
          <BottomSheet open={false} onOpenChange={vi.fn()} ariaLabel="A">
            <div>a</div>
          </BottomSheet>
          <BottomSheet open={true} onOpenChange={vi.fn()} ariaLabel="B">
            <div>b</div>
          </BottomSheet>
        </>
      );
      expect(document.body.style.overflow).toBe("hidden");
      // Close the second sheet — body unlocks.
      rerender(
        <>
          <BottomSheet open={false} onOpenChange={vi.fn()} ariaLabel="A">
            <div>a</div>
          </BottomSheet>
          <BottomSheet open={false} onOpenChange={vi.fn()} ariaLabel="B">
            <div>b</div>
          </BottomSheet>
        </>
      );
      await waitFor(() => expect(document.body.style.overflow).toBe(""));
    });

    it("restores focus to the previously-focused element on close", async () => {
      // Place an external trigger that will own focus before the sheet
      // opens. The two-phase mount means the focus-trap effect runs after
      // `entered` flips true; whatever document.activeElement is at that
      // moment is what we'll restore on cleanup.
      const Wrapper = ({ open }: { open: boolean }) => (
        <>
          <button
            type="button"
            data-testid="external-trigger"
            autoFocus
          >
            trigger
          </button>
          <BottomSheet open={open} onOpenChange={vi.fn()} ariaLabel="Test">
            <button type="button" data-testid="inside-btn">inside</button>
          </BottomSheet>
        </>
      );
      const { rerender } = render(<Wrapper open={false} />);
      const trigger = screen.getByTestId("external-trigger");
      trigger.focus();
      expect(trigger).toHaveFocus();
      // Open the sheet — focus moves to the first inside button.
      rerender(<Wrapper open={true} />);
      await waitFor(() =>
        expect(screen.getByTestId("inside-btn")).toHaveFocus()
      );
      // Close the sheet — focus should be restored to the trigger.
      rerender(<Wrapper open={false} />);
      await waitFor(() => expect(trigger).toHaveFocus());
    });
  });
});
