/**
 * MobileChannelComposer tests (Phase 5 mobile redesign).
 *
 * Verifies the actual DOM contract: autocorrect attributes are on, Enter
 * submits, Shift+Enter inserts a newline, and the long-press send path
 * keeps the draft in the textarea instead of submitting.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, act, waitFor } from "@testing-library/react";

const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: { error: (msg: string) => toastError(msg) },
}));

import { MobileChannelComposer } from "../MobileChannelComposer";

beforeEach(() => {
  toastError.mockReset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("MobileChannelComposer", () => {
  it("enables autocorrect and prose-friendly keyboard hints", () => {
    render(<MobileChannelComposer onSubmit={() => {}} />);
    const textarea = screen.getByTestId("mobile-channel-composer-textarea");
    expect(textarea.getAttribute("autocorrect")).toBe("on");
    expect(textarea.getAttribute("autocapitalize")).toBe("sentences");
    expect(textarea.getAttribute("spellcheck")).toBe("true");
    expect(textarea.getAttribute("enterkeyhint")).toBe("send");
  });

  it("submits on Enter and clears the textarea", () => {
    const onSubmit = vi.fn();
    render(<MobileChannelComposer onSubmit={onSubmit} />);
    const textarea = screen.getByTestId(
      "mobile-channel-composer-textarea"
    ) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "hello world" } });
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledWith("hello world");
    expect(textarea.value).toBe("");
  });

  it("does not submit on Shift+Enter", () => {
    const onSubmit = vi.fn();
    render(<MobileChannelComposer onSubmit={onSubmit} />);
    const textarea = screen.getByTestId("mobile-channel-composer-textarea");
    fireEvent.change(textarea, { target: { value: "line one" } });
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("does not submit when textarea is empty", () => {
    const onSubmit = vi.fn();
    render(<MobileChannelComposer onSubmit={onSubmit} />);
    const textarea = screen.getByTestId("mobile-channel-composer-textarea");
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("trims whitespace before submitting", () => {
    const onSubmit = vi.fn();
    render(<MobileChannelComposer onSubmit={onSubmit} />);
    const textarea = screen.getByTestId("mobile-channel-composer-textarea");
    fireEvent.change(textarea, { target: { value: "   hi   " } });
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledWith("hi");
  });

  it("long-press on send keeps the text instead of submitting", () => {
    vi.useFakeTimers();
    const onSubmit = vi.fn();
    render(<MobileChannelComposer onSubmit={onSubmit} />);
    const textarea = screen.getByTestId(
      "mobile-channel-composer-textarea"
    ) as HTMLTextAreaElement;
    const send = screen.getByTestId("mobile-channel-composer-send");
    fireEvent.change(textarea, { target: { value: "draft prompt" } });
    fireEvent.pointerDown(send);
    act(() => {
      vi.advanceTimersByTime(450);
    });
    fireEvent.pointerUp(send);
    fireEvent.click(send);
    // Long-press swallowed the click — onSubmit NOT called, draft preserved.
    expect(onSubmit).not.toHaveBeenCalled();
    expect(textarea.value).toBe("draft prompt");
  });

  it("restores the draft and toasts when onSubmit rejects", async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error("network down"));
    render(<MobileChannelComposer onSubmit={onSubmit} />);
    const textarea = screen.getByTestId(
      "mobile-channel-composer-textarea"
    ) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "important draft" } });
    fireEvent.keyDown(textarea, { key: "Enter" });
    // Draft cleared optimistically.
    expect(textarea.value).toBe("");
    // After the rejection settles, the draft is restored and an error
    // toast is shown so the user can retry.
    await waitFor(() => {
      expect(textarea.value).toBe("important draft");
      expect(toastError).toHaveBeenCalledWith("Failed to send. Try again.");
    });
  });

  it("send button is disabled while textarea is empty", () => {
    render(<MobileChannelComposer onSubmit={() => {}} />);
    const send = screen.getByTestId(
      "mobile-channel-composer-send"
    ) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
  });
});
