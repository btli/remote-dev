import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BeadsIssue } from "@/types/beads";

const apiFetch = vi.fn();
vi.mock("@/lib/api-fetch", () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
}));

import { BeadsIssueDetail } from "../BeadsIssueDetail";

function jsonResponse(body: unknown) {
  return { ok: true, json: async () => body } as unknown as Response;
}

function errorResponse() {
  return { ok: false, status: 500, json: async () => ({}) } as unknown as Response;
}

function makeIssue(overrides: Partial<BeadsIssue> = {}): BeadsIssue {
  return {
    id: "rd-test1",
    title: "Test issue",
    description: "",
    status: "open",
    priority: 2,
    issueType: "task",
    assignee: null,
    owner: null,
    createdAt: new Date("2026-06-01T12:00:00Z"),
    createdBy: null,
    updatedAt: new Date("2026-06-01T12:00:00Z"),
    closedAt: null,
    closeReason: null,
    design: "",
    acceptanceCriteria: "",
    notes: "",
    metadata: {},
    labels: [],
    dependencies: [],
    dependents: [],
    parents: [],
    children: [],
    ...overrides,
  };
}

function renderDetail(issue: BeadsIssue) {
  return render(
    <BeadsIssueDetail
      issue={issue}
      allIssues={[issue]}
      projectPath="/tmp/project"
      onNavigateToIssue={vi.fn()}
    />
  );
}

describe("BeadsIssueDetail", () => {
  beforeEach(() => {
    apiFetch.mockReset();
  });

  it("shows an error state with retry when the details fetch fails, and retry refetches", async () => {
    apiFetch.mockResolvedValueOnce(errorResponse());
    renderDetail(makeIssue());

    await waitFor(() =>
      expect(screen.getByText("Failed to load")).toBeInTheDocument()
    );

    apiFetch.mockResolvedValueOnce(
      jsonResponse({
        comments: [
          {
            id: "c1",
            issueId: "rd-test1",
            author: "alice",
            text: "hello from a comment",
            createdAt: "2026-06-02T10:00:00Z",
          },
        ],
        events: [],
      })
    );

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() =>
      expect(screen.getByText("hello from a comment")).toBeInTheDocument()
    );
    expect(apiFetch).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("Failed to load")).not.toBeInTheDocument();
  });

  it("shows the error state in the audit trail section too", async () => {
    apiFetch.mockResolvedValue(errorResponse());
    renderDetail(makeIssue());

    await waitFor(() =>
      expect(screen.getByText("Failed to load")).toBeInTheDocument()
    );

    fireEvent.click(screen.getByRole("button", { name: /^audit trail/i }));
    expect(screen.getAllByText("Failed to load")).toHaveLength(2);
  });

  it("refetches comments via the refresh button", async () => {
    apiFetch.mockResolvedValue(jsonResponse({ comments: [], events: [] }));
    renderDetail(makeIssue());

    await waitFor(() =>
      expect(screen.getByText("No comments")).toBeInTheDocument()
    );

    fireEvent.click(screen.getByRole("button", { name: "Refresh comments" }));

    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(2));
  });

  it("shows loading (not a stale error) during an in-flight retry, with refresh disabled and spinning", async () => {
    apiFetch.mockResolvedValueOnce(errorResponse());
    renderDetail(makeIssue());

    await waitFor(() =>
      expect(screen.getByText("Failed to load")).toBeInTheDocument()
    );

    let resolveFetch!: (value: Response) => void;
    apiFetch.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        })
    );

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    // While the refetch is in flight: loading indicator replaces the error,
    // and the refresh affordance is disabled + spinning.
    expect(screen.getByText("Loading...")).toBeInTheDocument();
    expect(screen.queryByText("Failed to load")).not.toBeInTheDocument();
    const refresh = screen.getByRole("button", { name: "Refresh comments" });
    expect(refresh).toBeDisabled();
    expect(refresh.querySelector("svg")).toHaveClass("animate-spin");

    resolveFetch(jsonResponse({ comments: [], events: [] }));

    await waitFor(() =>
      expect(screen.getByText("No comments")).toBeInTheDocument()
    );
    expect(refresh).toBeEnabled();
    expect(refresh.querySelector("svg")).not.toHaveClass("animate-spin");
  });

  it("renders 'unknown' instead of 'Invalid Date' for invalid dates", async () => {
    apiFetch.mockResolvedValue(jsonResponse({ comments: [], events: [] }));
    renderDetail(makeIssue({ createdAt: new Date("not-a-date") }));

    expect(screen.getByText("Created unknown")).toBeInTheDocument();
    expect(screen.queryByText(/Invalid Date/)).not.toBeInTheDocument();

    await waitFor(() =>
      expect(screen.getByText("No comments")).toBeInTheDocument()
    );
  });

  it("exposes aria-expanded on every section toggle", async () => {
    apiFetch.mockResolvedValue(jsonResponse({ comments: [], events: [] }));
    renderDetail(
      makeIssue({
        dependencies: [
          {
            issueId: "rd-test1",
            dependsOnId: "rd-dep1",
            type: "blocks",
            createdAt: new Date("2026-06-01T12:00:00Z"),
            createdBy: "alice",
          },
        ],
      })
    );

    await waitFor(() =>
      expect(screen.getByText("No comments")).toBeInTheDocument()
    );

    const description = screen.getByRole("button", { name: "Description" });
    expect(description).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(description);
    expect(description).toHaveAttribute("aria-expanded", "false");

    expect(
      screen.getByRole("button", { name: /^dependencies/i })
    ).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: /^comments/i })).toHaveAttribute(
      "aria-expanded",
      "true"
    );
    expect(
      screen.getByRole("button", { name: /^audit trail/i })
    ).toHaveAttribute("aria-expanded", "false");
  });
});
