import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { BeadsIssue, BeadsDependency } from "@/types/beads";

import { BeadsDependencyTree } from "../BeadsDependencyTree";

function makeDep(issueId: string, dependsOnId: string): BeadsDependency {
  return {
    issueId,
    dependsOnId,
    type: "blocks",
    createdAt: new Date("2026-06-01T12:00:00Z"),
    createdBy: "alice",
  };
}

function makeIssue(
  id: string,
  title: string,
  overrides: Partial<BeadsIssue> = {}
): BeadsIssue {
  return {
    id,
    title,
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

describe("BeadsDependencyTree", () => {
  it("labels nodes missing from the loaded set as '(not loaded)' with an explanatory title", () => {
    const root = makeIssue("rd-root", "Root issue", {
      dependencies: [makeDep("rd-root", "rd-missing")],
    });

    render(
      <BeadsDependencyTree
        issue={root}
        allIssues={[root]}
        onNavigateToIssue={vi.fn()}
      />
    );

    const label = screen.getByText("(not loaded)");
    expect(label).toBeInTheDocument();
    expect(label.closest("div")).toHaveAttribute(
      "title",
      "Not in the loaded issue set — usually closed beyond the retention window"
    );
    expect(screen.queryByText("(not found)")).not.toBeInTheDocument();
  });

  it("exposes aria-expanded and aria-label on the expand/collapse chevron", () => {
    const grandchild = makeIssue("rd-c", "Issue C");
    const child = makeIssue("rd-b", "Issue B", {
      dependencies: [makeDep("rd-b", "rd-c")],
    });
    const root = makeIssue("rd-root", "Root issue", {
      dependencies: [makeDep("rd-root", "rd-b")],
    });

    render(
      <BeadsDependencyTree
        issue={root}
        allIssues={[root, child, grandchild]}
        onNavigateToIssue={vi.fn()}
      />
    );

    // Expanded by default at depth 0 → grandchild visible
    expect(screen.getByText("Issue C")).toBeInTheDocument();

    const chevron = screen.getByRole("button", { name: "Collapse" });
    expect(chevron).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(chevron);

    const collapsed = screen.getByRole("button", { name: "Expand" });
    expect(collapsed).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Issue C")).not.toBeInTheDocument();
  });
});
