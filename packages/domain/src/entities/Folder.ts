/**
 * Folder - Domain entity representing a session folder.
 *
 * Folders provide hierarchical organization for terminal sessions
 * with preference inheritance (child folders inherit parent preferences).
 *
 * Invariants:
 * - A folder must have a unique ID and belong to a user
 * - A folder cannot be its own parent (no self-reference)
 * - Folder hierarchy must not contain cycles
 * - Sort order is maintained among siblings
 */

import { InvalidValueError, BusinessRuleViolationError } from "../errors/DomainError";

export interface FolderProps {
  id: string;
  userId: string;
  parentId: string | null;
  name: string;
  collapsed: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateFolderProps {
  id?: string;
  userId: string;
  name: string;
  parentId?: string | null;
  sortOrder?: number;
}

/**
 * Generate a UUID using the standard crypto API.
 */
function generateUUID(): string {
  if (typeof globalThis !== "undefined" && globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export class Folder {
  private constructor(private readonly props: FolderProps) {
    this.validateInvariants();
  }

  private validateInvariants(): void {
    if (!this.props.id || typeof this.props.id !== "string") {
      throw new InvalidValueError("Folder.id", this.props.id, "Must be a non-empty string");
    }
    if (!this.props.userId || typeof this.props.userId !== "string") {
      throw new InvalidValueError("Folder.userId", this.props.userId, "Must be a non-empty string");
    }
    if (!this.props.name || typeof this.props.name !== "string" || !this.props.name.trim()) {
      throw new InvalidValueError("Folder.name", this.props.name, "Must be a non-empty string");
    }
    if (this.props.parentId === this.props.id) {
      throw new BusinessRuleViolationError(
        "Folder cannot be its own parent",
        `Folder ${this.props.id} has parentId set to itself`
      );
    }
  }

  /**
   * Create a new Folder.
   */
  static create(props: CreateFolderProps): Folder {
    const now = new Date();

    return new Folder({
      id: props.id ?? generateUUID(),
      userId: props.userId,
      parentId: props.parentId ?? null,
      name: props.name.trim(),
      collapsed: false,
      sortOrder: props.sortOrder ?? 0,
      createdAt: now,
      updatedAt: now,
    });
  }

  /**
   * Reconstitute a Folder from persisted data.
   */
  static reconstitute(props: FolderProps): Folder {
    return new Folder(props);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Getters
  // ─────────────────────────────────────────────────────────────────────────────

  get id(): string {
    return this.props.id;
  }

  get userId(): string {
    return this.props.userId;
  }

  get parentId(): string | null {
    return this.props.parentId;
  }

  get name(): string {
    return this.props.name;
  }

  get collapsed(): boolean {
    return this.props.collapsed;
  }

  get sortOrder(): number {
    return this.props.sortOrder;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get updatedAt(): Date {
    return this.props.updatedAt;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Domain Methods
  // ─────────────────────────────────────────────────────────────────────────────

  rename(newName: string): Folder {
    if (!newName || typeof newName !== "string" || !newName.trim()) {
      throw new InvalidValueError("name", newName, "Must be a non-empty string");
    }
    return this.withUpdates({ name: newName.trim() });
  }

  toggleCollapsed(): Folder {
    return this.withUpdates({ collapsed: !this.props.collapsed });
  }

  setCollapsed(collapsed: boolean): Folder {
    return this.withUpdates({ collapsed });
  }

  setSortOrder(sortOrder: number): Folder {
    return this.withUpdates({ sortOrder });
  }

  moveTo(newParentId: string | null, allFolders: Folder[]): Folder {
    if (newParentId === this.props.id) {
      throw new BusinessRuleViolationError(
        "Folder cannot be its own parent",
        `Cannot move folder ${this.props.id} into itself`
      );
    }

    if (newParentId && this.wouldCreateCycle(newParentId, allFolders)) {
      throw new BusinessRuleViolationError(
        "Circular folder reference",
        `Moving folder ${this.props.id} to ${newParentId} would create a cycle`
      );
    }

    return this.withUpdates({ parentId: newParentId });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Query Methods
  // ─────────────────────────────────────────────────────────────────────────────

  isRoot(): boolean {
    return this.props.parentId === null;
  }

  belongsTo(userId: string): boolean {
    return this.props.userId === userId;
  }

  isChildOf(folderId: string): boolean {
    return this.props.parentId === folderId;
  }

  private wouldCreateCycle(newParentId: string, allFolders: Folder[]): boolean {
    const folderMap = new Map(allFolders.map((f) => [f.id, f]));

    let currentId: string | null = newParentId;
    while (currentId !== null) {
      if (currentId === this.props.id) {
        return true;
      }
      const current = folderMap.get(currentId);
      currentId = current?.parentId ?? null;
    }

    return false;
  }

  getAncestorIds(allFolders: Folder[]): string[] {
    const folderMap = new Map(allFolders.map((f) => [f.id, f]));
    const ancestors: string[] = [];

    let currentId = this.props.parentId;
    while (currentId !== null) {
      ancestors.push(currentId);
      const current = folderMap.get(currentId);
      currentId = current?.parentId ?? null;
    }

    return ancestors;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Private Helpers
  // ─────────────────────────────────────────────────────────────────────────────

  private withUpdates(updates: Partial<FolderProps>): Folder {
    return new Folder({
      ...this.props,
      ...updates,
      updatedAt: new Date(),
    });
  }

  toPlainObject(): FolderProps {
    return { ...this.props };
  }
}
