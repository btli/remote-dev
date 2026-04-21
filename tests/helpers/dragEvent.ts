import { createEvent, fireEvent } from "@testing-library/react";

/**
 * happy-dom's DragEvent is aliased to Event, whose constructor discards non-standard
 * init fields like `clientY`. This helper creates the event, then defineProperty's
 * clientY onto it before firing.
 */
export function fireDragEvent(
  node: Element,
  kind: "dragStart" | "dragOver" | "dragLeave" | "dragEnd" | "drop",
  init: { clientY?: number; clientX?: number; dataTransfer?: unknown } = {},
) {
  const event = createEvent[kind](node, {
    bubbles: true,
    cancelable: true,
    dataTransfer: init.dataTransfer as never,
  });
  if (init.clientY !== undefined) {
    Object.defineProperty(event, "clientY", {
      value: init.clientY,
      configurable: true,
    });
  }
  if (init.clientX !== undefined) {
    Object.defineProperty(event, "clientX", {
      value: init.clientX,
      configurable: true,
    });
  }
  fireEvent(node, event);
  return event;
}
