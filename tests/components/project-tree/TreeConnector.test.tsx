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

  it("sets --tree-connector-left based on depth", () => {
    const { container } = render(
      <TreeConnector depth={3} isLastChild={false}>
        <span />
      </TreeConnector>
    );
    // depth*12 + 8 + 7 = 51 for depth 3
    const el = container.firstElementChild as HTMLElement;
    expect(el.style.getPropertyValue("--tree-connector-left")).toBe("51px");
    expect(el.style.getPropertyValue("--tree-connector-width")).toBe("8px");
  });
});
