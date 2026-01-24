/**
 * PortConflictError - Domain error for port allocation conflicts.
 *
 * Thrown when a session or folder attempts to use a port that is either:
 * - Already registered to another folder (database conflict)
 * - Already in use by a running process (runtime conflict)
 *
 * This error provides detailed information about each conflict to help
 * users understand and resolve the issue.
 */

import { DomainError } from "./DomainError";

/**
 * Represents a single port conflict.
 */
export interface PortConflict {
  /** The conflicting port number */
  port: number;

  /** The environment variable name that defines this port (e.g., "PORT", "API_PORT") */
  variableName: string;

  /** Information about what's using the port */
  conflictSource:
    | {
        type: "folder";
        folderId: string;
        folderName: string;
        variableName: string;
      }
    | {
        type: "runtime";
        processInfo?: string;
      };

  /** A suggested alternative port, if one could be found */
  suggestedPort?: number;
}

/**
 * Error thrown when port conflicts are detected.
 */
export class PortConflictError extends DomainError {
  private readonly _conflicts: readonly PortConflict[];

  constructor(conflicts: PortConflict[]) {
    const message = PortConflictError.formatMessage(conflicts);
    super(message, "PORT_CONFLICT");
    this._conflicts = Object.freeze([...conflicts]);
  }

  /**
   * Get the list of port conflicts.
   */
  get conflicts(): readonly PortConflict[] {
    return this._conflicts;
  }

  /**
   * Check if there are any conflicts.
   */
  get hasConflicts(): boolean {
    return this._conflicts.length > 0;
  }

  /**
   * Get only database conflicts (conflicts with other folders).
   */
  get databaseConflicts(): readonly PortConflict[] {
    return this._conflicts.filter((c) => c.conflictSource.type === "folder");
  }

  /**
   * Get only runtime conflicts (ports actually in use).
   */
  get runtimeConflicts(): readonly PortConflict[] {
    return this._conflicts.filter((c) => c.conflictSource.type === "runtime");
  }

  /**
   * Get all conflicting port numbers.
   */
  get ports(): readonly number[] {
    return this._conflicts.map((c) => c.port);
  }

  /**
   * Check if a specific port is in conflict.
   */
  hasPortConflict(port: number): boolean {
    return this._conflicts.some((c) => c.port === port);
  }

  /**
   * Get the conflict for a specific port.
   */
  getConflictForPort(port: number): PortConflict | undefined {
    return this._conflicts.find((c) => c.port === port);
  }

  /**
   * Format a human-readable error message.
   */
  private static formatMessage(conflicts: PortConflict[]): string {
    if (conflicts.length === 0) {
      return "No port conflicts";
    }

    if (conflicts.length === 1) {
      return PortConflictError.formatSingleConflict(conflicts[0]);
    }

    const lines = [
      `${conflicts.length} port conflicts detected:`,
      ...conflicts.map((c) => `  - ${PortConflictError.formatConflictLine(c)}`),
    ];

    return lines.join("\n");
  }

  /**
   * Format a single conflict as a complete message.
   */
  private static formatSingleConflict(conflict: PortConflict): string {
    const source = conflict.conflictSource;
    let message = `Port ${conflict.port} (${conflict.variableName}) `;

    if (source.type === "folder") {
      message += `is already used by folder "${source.folderName}" for ${source.variableName}`;
    } else {
      message += `is already in use by another process`;
      if (source.processInfo) {
        message += ` (${source.processInfo})`;
      }
    }

    if (conflict.suggestedPort) {
      message += `. Suggested alternative: ${conflict.suggestedPort}`;
    }

    return message;
  }

  /**
   * Format a conflict as a single line for multi-conflict messages.
   */
  private static formatConflictLine(conflict: PortConflict): string {
    const source = conflict.conflictSource;
    let line = `Port ${conflict.port} (${conflict.variableName}): `;

    if (source.type === "folder") {
      line += `used by folder "${source.folderName}"`;
    } else {
      line += `in use by process`;
      if (source.processInfo) {
        line += ` (${source.processInfo})`;
      }
    }

    if (conflict.suggestedPort) {
      line += ` → try ${conflict.suggestedPort}`;
    }

    return line;
  }

  /**
   * Create a PortConflictError for a single database conflict.
   */
  static fromDatabaseConflict(
    port: number,
    variableName: string,
    folderId: string,
    folderName: string,
    conflictingVariableName: string,
    suggestedPort?: number
  ): PortConflictError {
    return new PortConflictError([
      {
        port,
        variableName,
        conflictSource: {
          type: "folder",
          folderId,
          folderName,
          variableName: conflictingVariableName,
        },
        suggestedPort,
      },
    ]);
  }

  /**
   * Create a PortConflictError for a single runtime conflict.
   */
  static fromRuntimeConflict(
    port: number,
    variableName: string,
    processInfo?: string,
    suggestedPort?: number
  ): PortConflictError {
    return new PortConflictError([
      {
        port,
        variableName,
        conflictSource: {
          type: "runtime",
          processInfo,
        },
        suggestedPort,
      },
    ]);
  }
}
