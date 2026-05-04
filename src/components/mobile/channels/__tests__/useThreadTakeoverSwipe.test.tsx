/**
 * useThreadTakeoverSwipe tests (Phase 5 mobile redesign).
 *
 * Verifies the back-gesture state machine: start near the left edge, drag
 * rightward past threshold, fire onDismiss.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup, act } from "@testing-library/react";
import { useRef, type CSSProperties } from "react";

import {
  useThreadTakeoverSwipe,
  type UseThreadTakeoverSwipeOptions,
} from "../useThreadTakeoverSwipe";

afterEach(() => cleanup());

function Harness({
  onDismiss,
  edgeThresholdPx,
  horizontalThresholdPx,
}: Pick<UseThreadTakeoverSwipeOptions, "onDismiss" | "edgeThresholdPx" | "horizontalThresholdPx">) {
  const ref = useRef<HTMLDivElement>(null);
  const swipe = useThreadTakeoverSwipe({
    onDismiss,
    edgeThresholdPx,
    horizontalThresholdPx,
  });
  const style: CSSProperties = swipe.dragging
    ? { transform: `translate3d(${swipe.dragOffsetPx}px,0,0)` }
    : {};
  return (
    <div
      ref={ref}
      data-testid="harness"
      data-dragging={swipe.dragging ? "true" : "false"}
      style={style}
      onTouchStart={swipe.bind.onTouchStart}
      onTouchMove={swipe.bind.onTouchMove}
      onTouchEnd={swipe.bind.onTouchEnd}
      onTouchCancel={swipe.bind.onTouchCancel}
    >
      panel
    </div>
  );
}

function makeTouch(x: number, y: number): Touch {
  return { clientX: x, clientY: y } as unknown as Touch;
}

describe("useThreadTakeoverSwipe", () => {
  it("does not trigger when the touch starts away from the left edge", () => {
    const onDismiss = vi.fn();
    const { getByTestId } = render(<Harness onDismiss={onDismiss} />);
    const el = getByTestId("harness");
    // happy-dom returns 0,0,0,0 for getBoundingClientRect; we use a touch
    // intentionally past the edge threshold (default 24).
    fireEvent.touchStart(el, { touches: [makeTouch(50, 100)] });
    fireEvent.touchMove(el, { touches: [makeTouch(200, 100)] });
    fireEvent.touchEnd(el);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("triggers onDismiss when an edge swipe travels past the horizontal threshold", () => {
    const onDismiss = vi.fn();
    const { getByTestId } = render(
      <Harness onDismiss={onDismiss} horizontalThresholdPx={50} />
    );
    const el = getByTestId("harness");
    fireEvent.touchStart(el, { touches: [makeTouch(5, 100)] });
    fireEvent.touchMove(el, { touches: [makeTouch(60, 105)] });
    expect(el.getAttribute("data-dragging")).toBe("true");
    fireEvent.touchEnd(el);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("does not trigger when the swipe is shorter than the horizontal threshold", () => {
    const onDismiss = vi.fn();
    const { getByTestId } = render(
      <Harness onDismiss={onDismiss} horizontalThresholdPx={80} />
    );
    const el = getByTestId("harness");
    fireEvent.touchStart(el, { touches: [makeTouch(5, 100)] });
    fireEvent.touchMove(el, { touches: [makeTouch(40, 100)] });
    fireEvent.touchEnd(el);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("ignores swipes that are mostly vertical", () => {
    const onDismiss = vi.fn();
    const { getByTestId } = render(<Harness onDismiss={onDismiss} />);
    const el = getByTestId("harness");
    fireEvent.touchStart(el, { touches: [makeTouch(5, 100)] });
    // Big vertical, small horizontal — looks like a scroll.
    fireEvent.touchMove(el, { touches: [makeTouch(15, 220)] });
    fireEvent.touchEnd(el);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("does not trigger on leftward (wrong-direction) drags", () => {
    const onDismiss = vi.fn();
    const { getByTestId } = render(<Harness onDismiss={onDismiss} />);
    const el = getByTestId("harness");
    fireEvent.touchStart(el, { touches: [makeTouch(5, 100)] });
    fireEvent.touchMove(el, { touches: [makeTouch(-100, 100)] });
    fireEvent.touchEnd(el);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("resets drag offset after release without trigger", () => {
    const onDismiss = vi.fn();
    const { getByTestId } = render(
      <Harness onDismiss={onDismiss} horizontalThresholdPx={120} />
    );
    const el = getByTestId("harness");
    fireEvent.touchStart(el, { touches: [makeTouch(5, 100)] });
    fireEvent.touchMove(el, { touches: [makeTouch(40, 100)] });
    expect(el.getAttribute("data-dragging")).toBe("true");
    act(() => {
      fireEvent.touchEnd(el);
    });
    expect(el.getAttribute("data-dragging")).toBe("false");
    expect(onDismiss).not.toHaveBeenCalled();
  });
});
