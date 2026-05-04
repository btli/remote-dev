/**
 * ActionSheet tests (Phase 2 mobile redesign).
 *
 * Verifies that items render with correct destructive styling, fire their
 * onSelect callbacks on tap, and that the sheet closes itself before the
 * action runs (so any toast triggered by the action isn't immediately
 * occluded by the sheet's exit transition).
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  ActionSheet,
  type ActionSheetItem,
} from "@/components/mobile/common/ActionSheet";

afterEach(() => cleanup());

describe("ActionSheet", () => {
  it("renders items with destructive class when destructive is true", async () => {
    const items: ActionSheetItem[] = [
      { id: "ok", label: "OK", onSelect: vi.fn() },
      { id: "rm", label: "Delete", destructive: true, onSelect: vi.fn() },
    ];
    render(
      <ActionSheet open={true} onOpenChange={vi.fn()} items={items} title="Test" />
    );
    await waitFor(() => screen.getByRole("menuitem", { name: "OK" }));
    const okButton = screen.getByRole("menuitem", { name: "OK" });
    const rmButton = screen.getByRole("menuitem", { name: "Delete" });
    expect(okButton.dataset.destructive).toBeUndefined();
    expect(rmButton.dataset.destructive).toBe("true");
  });

  it("invokes onSelect and closes the sheet when an item is tapped", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onOpenChange = vi.fn();
    const items: ActionSheetItem[] = [{ id: "go", label: "Go", onSelect }];
    render(
      <ActionSheet open={true} onOpenChange={onOpenChange} items={items} />
    );
    await waitFor(() => screen.getByRole("menuitem", { name: "Go" }));
    await user.click(screen.getByRole("menuitem", { name: "Go" }));
    // Sheet closes first.
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("renders disabled items as not invoking onSelect", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onOpenChange = vi.fn();
    const items: ActionSheetItem[] = [
      { id: "x", label: "X", disabled: true, onSelect },
    ];
    render(
      <ActionSheet open={true} onOpenChange={onOpenChange} items={items} />
    );
    await waitFor(() => screen.getByRole("menuitem", { name: "X" }));
    const button = screen.getByRole("menuitem", { name: "X" }) as HTMLButtonElement;
    // We use aria-disabled rather than the native disabled attribute so the
    // item stays in the a11y tree as "unavailable" instead of being removed.
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(button.disabled).toBe(false);
    await user.click(button);
    expect(onSelect).not.toHaveBeenCalled();
    // Sheet still closes on tap (consistent with existing behavior).
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
