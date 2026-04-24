import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { TreeConnector } from "@/components/session/project-tree/TreeConnector";

describe("TreeConnector", () => {
  it("renders children", () => {
    const { getByText } = render(
      <TreeConnector depth={2} isLastChild={false}>
        <span>hi</span>
      </TreeConnector>
    );
    expect(getByText("hi")).toBeInTheDocument();
  });

  it("sets data-tree-last when isLastChild", () => {
    const { container } = render(
      <TreeConnector depth={0} isLastChild>
        <span />
      </TreeConnector>
    );
    expect(container.firstElementChild).toHaveAttribute("data-tree-last", "true");
  });

  it("omits data-tree-last when not last", () => {
    const { container } = render(
      <TreeConnector depth={0} isLastChild={false}>
        <span />
      </TreeConnector>
    );
    expect(container.firstElementChild).not.toHaveAttribute("data-tree-last");
  });

  it("does not render the legacy vertical nesting bar CSS variables", () => {
    // The `.tree-item::before` pseudo-element was removed along with its
    // driving CSS variables. Asserting their absence pins the behavior so a
    // regression would be caught here rather than via manual QA.
    const { container } = render(
      <TreeConnector depth={3} isLastChild={false}>
        <span />
      </TreeConnector>
    );
    const el = container.firstElementChild as HTMLElement;
    expect(el.style.getPropertyValue("--tree-connector-left")).toBe("");
    expect(el.style.getPropertyValue("--tree-connector-width")).toBe("");
  });
});
