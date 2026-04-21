import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { SessionRow } from "@/components/session/project-tree/SessionRow";
import { ProjectRow } from "@/components/session/project-tree/ProjectRow";
import { GroupRow } from "@/components/session/project-tree/GroupRow";
import type { GroupNode, ProjectNode } from "@/contexts/ProjectTreeContext";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal test double for TerminalSession
const shellSession: any = {
  id: "s1",
  name: "web-server",
  projectId: "p1",
  pinned: false,
  terminalType: "shell",
};

const baseSessionProps = {
  depth: 1,
  isActive: false,
  isEditing: false,
  hasUnread: false,
  agentStatus: null as null,
  scheduleCount: 0,
  onClick: vi.fn(),
  onClose: vi.fn(),
  onStartEdit: vi.fn(),
};

const baseProject: ProjectNode = {
  id: "p1",
  name: "app",
  groupId: "g1",
  isAutoCreated: false,
  sortOrder: 0,
  collapsed: false,
};

const baseProjectProps = {
  depth: 1,
  isActive: false,
  collapsed: false,
  sessionCount: 0,
  ownStats: null,
  hasCustomPrefs: false,
  hasActiveSecrets: false,
  hasLinkedRepo: false,
  onSelect: vi.fn(),
  onToggleCollapse: vi.fn(),
};

const baseGroup: GroupNode = {
  id: "g1",
  name: "Workspace",
  parentGroupId: null,
  collapsed: false,
  sortOrder: 0,
};

const baseGroupProps = {
  depth: 0,
  isActive: false,
  sessionCount: 0,
  rolledStats: null,
  hasCustomPrefs: false,
  onSelect: vi.fn(),
  onToggleCollapse: vi.fn(),
};

// Helper: does any element in the container have the given class?
function hasClass(container: HTMLElement, cls: string): boolean {
  const all = container.querySelectorAll("*");
  for (const el of Array.from(all)) {
    if ((el as HTMLElement).className &&
      typeof (el as HTMLElement).className === "string" &&
      (el as HTMLElement).className.split(/\s+/).includes(cls)) {
      return true;
    }
  }
  return false;
}

describe("dropIndicator — SessionRow", () => {
  it("renders a before-bar when dropIndicator=before", () => {
    const { container } = render(
      <SessionRow {...baseSessionProps} session={shellSession} dropIndicator="before" />,
    );
    expect(hasClass(container, "-top-0.5")).toBe(true);
  });

  it("renders an after-bar when dropIndicator=after", () => {
    const { container } = render(
      <SessionRow {...baseSessionProps} session={shellSession} dropIndicator="after" />,
    );
    expect(hasClass(container, "-bottom-0.5")).toBe(true);
  });

  it("applies nest background/border when dropIndicator=nest", () => {
    const { container } = render(
      <SessionRow {...baseSessionProps} session={shellSession} dropIndicator="nest" />,
    );
    expect(hasClass(container, "bg-primary/20")).toBe(true);
    expect(hasClass(container, "border-primary/30")).toBe(true);
  });

  it("renders no indicator styles when dropIndicator is null / undefined", () => {
    const { container: c1 } = render(
      <SessionRow {...baseSessionProps} session={shellSession} dropIndicator={null} />,
    );
    expect(hasClass(c1, "-top-0.5")).toBe(false);
    expect(hasClass(c1, "-bottom-0.5")).toBe(false);
    expect(hasClass(c1, "border-primary/30")).toBe(false);

    const { container: c2 } = render(
      <SessionRow {...baseSessionProps} session={shellSession} />,
    );
    expect(hasClass(c2, "-top-0.5")).toBe(false);
    expect(hasClass(c2, "-bottom-0.5")).toBe(false);
    expect(hasClass(c2, "border-primary/30")).toBe(false);
  });
});

describe("dropIndicator — ProjectRow", () => {
  it("renders a before-bar when dropIndicator=before", () => {
    const { container } = render(
      <ProjectRow {...baseProjectProps} project={baseProject} dropIndicator="before" />,
    );
    expect(hasClass(container, "-top-0.5")).toBe(true);
  });

  it("renders an after-bar when dropIndicator=after", () => {
    const { container } = render(
      <ProjectRow {...baseProjectProps} project={baseProject} dropIndicator="after" />,
    );
    expect(hasClass(container, "-bottom-0.5")).toBe(true);
  });

  it("applies nest background/border when dropIndicator=nest", () => {
    const { container } = render(
      <ProjectRow {...baseProjectProps} project={baseProject} dropIndicator="nest" />,
    );
    expect(hasClass(container, "bg-primary/20")).toBe(true);
    expect(hasClass(container, "border-primary/30")).toBe(true);
  });

  it("renders no indicator styles when dropIndicator is null / undefined", () => {
    const { container: c1 } = render(
      <ProjectRow {...baseProjectProps} project={baseProject} dropIndicator={null} />,
    );
    expect(hasClass(c1, "-top-0.5")).toBe(false);
    expect(hasClass(c1, "-bottom-0.5")).toBe(false);
    expect(hasClass(c1, "bg-primary/20")).toBe(false);

    const { container: c2 } = render(
      <ProjectRow {...baseProjectProps} project={baseProject} />,
    );
    expect(hasClass(c2, "-top-0.5")).toBe(false);
    expect(hasClass(c2, "-bottom-0.5")).toBe(false);
    expect(hasClass(c2, "bg-primary/20")).toBe(false);
  });
});

describe("dropIndicator — GroupRow", () => {
  it("renders a before-bar when dropIndicator=before", () => {
    const { container } = render(
      <GroupRow {...baseGroupProps} group={baseGroup} dropIndicator="before" />,
    );
    expect(hasClass(container, "-top-0.5")).toBe(true);
  });

  it("renders an after-bar when dropIndicator=after", () => {
    const { container } = render(
      <GroupRow {...baseGroupProps} group={baseGroup} dropIndicator="after" />,
    );
    expect(hasClass(container, "-bottom-0.5")).toBe(true);
  });

  it("applies nest background/border when dropIndicator=nest", () => {
    const { container } = render(
      <GroupRow {...baseGroupProps} group={baseGroup} dropIndicator="nest" />,
    );
    expect(hasClass(container, "bg-primary/20")).toBe(true);
    expect(hasClass(container, "border-primary/30")).toBe(true);
  });

  it("renders no indicator styles when dropIndicator is null / undefined", () => {
    const { container: c1 } = render(
      <GroupRow {...baseGroupProps} group={baseGroup} dropIndicator={null} />,
    );
    expect(hasClass(c1, "-top-0.5")).toBe(false);
    expect(hasClass(c1, "-bottom-0.5")).toBe(false);
    expect(hasClass(c1, "bg-primary/20")).toBe(false);

    const { container: c2 } = render(
      <GroupRow {...baseGroupProps} group={baseGroup} />,
    );
    expect(hasClass(c2, "-top-0.5")).toBe(false);
    expect(hasClass(c2, "-bottom-0.5")).toBe(false);
    expect(hasClass(c2, "bg-primary/20")).toBe(false);
  });
});
