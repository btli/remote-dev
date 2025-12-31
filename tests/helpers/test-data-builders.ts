/**
 * Test Data Builders for Domain Entities
 *
 * These builders provide a fluent API for creating test data with sensible defaults.
 * Use them to create domain entities in tests without specifying all properties.
 */

import { vi } from "vitest";
import { Session, type CreateSessionProps } from "@/domain/entities/Session";

// ─────────────────────────────────────────────────────────────────────────────
// Session Builder
// ─────────────────────────────────────────────────────────────────────────────

interface SessionBuilderProps extends CreateSessionProps {
  status?: "active" | "suspended" | "closed" | "trashed";
}

export class SessionBuilder {
  private props: SessionBuilderProps = {
    userId: "test-user-id",
    name: "Test Session",
    projectPath: "/home/user/project",
  };

  static create(): SessionBuilder {
    return new SessionBuilder();
  }

  withId(id: string): SessionBuilder {
    this.props.id = id;
    return this;
  }

  withUserId(userId: string): SessionBuilder {
    this.props.userId = userId;
    return this;
  }

  withName(name: string): SessionBuilder {
    this.props.name = name;
    return this;
  }

  withProjectPath(projectPath: string | null): SessionBuilder {
    this.props.projectPath = projectPath;
    return this;
  }

  withFolderId(folderId: string | null): SessionBuilder {
    this.props.folderId = folderId;
    return this;
  }

  withWorktreeBranch(branch: string | null): SessionBuilder {
    this.props.worktreeBranch = branch;
    return this;
  }

  withGithubRepoId(repoId: string | null): SessionBuilder {
    this.props.githubRepoId = repoId;
    return this;
  }

  withTabOrder(order: number): SessionBuilder {
    this.props.tabOrder = order;
    return this;
  }

  withStatus(status: "active" | "suspended" | "closed" | "trashed"): SessionBuilder {
    this.props.status = status;
    return this;
  }

  build(): Session {
    const session = Session.create(this.props);

    // Apply status transition if needed
    if (this.props.status && this.props.status !== "active") {
      switch (this.props.status) {
        case "suspended":
          return session.suspend();
        case "closed":
          return session.close();
        case "trashed":
          return session.trash();
      }
    }

    return session;
  }

  /**
   * Build a session that is already suspended
   */
  buildSuspended(): Session {
    return this.withStatus("suspended").build();
  }

  /**
   * Build a session that is closed
   */
  buildClosed(): Session {
    return this.withStatus("closed").build();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Folder Builder (placeholder for when we add folder tests)
// ─────────────────────────────────────────────────────────────────────────────

export class FolderBuilder {
  private props = {
    userId: "test-user-id",
    name: "Test Folder",
    parentId: null as string | null,
    isCollapsed: false,
    sortOrder: 0,
  };

  static create(): FolderBuilder {
    return new FolderBuilder();
  }

  withUserId(userId: string): FolderBuilder {
    this.props.userId = userId;
    return this;
  }

  withName(name: string): FolderBuilder {
    this.props.name = name;
    return this;
  }

  withParentId(parentId: string | null): FolderBuilder {
    this.props.parentId = parentId;
    return this;
  }

  withCollapsed(isCollapsed: boolean): FolderBuilder {
    this.props.isCollapsed = isCollapsed;
    return this;
  }

  withSortOrder(order: number): FolderBuilder {
    this.props.sortOrder = order;
    return this;
  }

  // build() will be implemented when we add Folder entity tests
  getProps() {
    return { ...this.props };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Mock Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a mock function with TypeScript support
 */
export function createMockFn<T extends (...args: unknown[]) => unknown>() {
  return vi.fn() as ReturnType<typeof vi.fn<T>>;
}
