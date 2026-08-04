// @vitest-environment happy-dom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("@/contexts/ProjectTreeContext", () => ({
  useProjectTree: () => ({ activeNode: { id: "project-1", type: "project" } }),
}));

vi.mock("@/components/profiles/ProfileSelector", () => ({
  ProfileSelector: () => <div>Profile selector</div>,
}));

vi.mock("@/lib/api-fetch", () => ({
  apiFetch: vi.fn(async () => ({
    ok: true,
    json: async () => ({ configs: [] }),
  })),
}));

import { TriggersSection } from "./TriggersSection";

describe("TriggersSection", () => {
  it("offers Cursor as an automation agent provider", async () => {
    const user = userEvent.setup();
    render(<TriggersSection />);

    await waitFor(() => expect(screen.getByText("No triggers yet. Create one to react to PR labels, new issues, or CI failures.")).toBeTruthy());
    await user.click(screen.getByRole("button", { name: /new trigger/i }));
    const providerSelect = screen.getAllByRole("combobox")[1];
    await user.click(providerSelect);

    expect(await screen.findByRole("option", { name: "cursor" })).toBeTruthy();
  });
});
