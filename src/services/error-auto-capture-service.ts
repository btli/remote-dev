/**
 * Error Auto-Capture Service
 *
 * Automatically detects compilation and runtime errors from terminal scrollback
 * and creates gotcha notes for learning and future reference.
 *
 * Supports:
 * - TypeScript/JavaScript errors (tsc, bun, node)
 * - Rust errors (rustc, cargo)
 * - Python errors (tracebacks)
 * - Go errors
 * - Generic shell errors
 */

import { db } from "@/db";
import { sdkNotes, type NoteType } from "@/db/schema";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface DetectedError {
  /** Error category */
  category: "compilation" | "runtime" | "permission" | "dependency" | "syntax" | "type";
  /** Programming language or tool that generated the error */
  language: "typescript" | "rust" | "python" | "go" | "shell" | "unknown";
  /** The error message or summary */
  message: string;
  /** Full error text including context */
  fullText: string;
  /** File path if detected */
  filePath?: string;
  /** Line number if detected */
  lineNumber?: number;
  /** Column number if detected */
  columnNumber?: number;
  /** Stack trace if available */
  stackTrace?: string;
  /** Suggested fix if pattern is recognized */
  suggestedFix?: string;
  /** Confidence score 0-1 */
  confidence: number;
}

export interface AutoCaptureResult {
  /** Errors detected */
  errors: DetectedError[];
  /** IDs of notes created */
  noteIds: string[];
  /** Number of errors deduplicated (already existed) */
  duplicatesSkipped: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Error Patterns
// ─────────────────────────────────────────────────────────────────────────────

interface ErrorPattern {
  name: string;
  category: DetectedError["category"];
  language: DetectedError["language"];
  /** Regex to match the error. First capture group should be the main message. */
  pattern: RegExp;
  /** Extract file/line info if available */
  locationPattern?: RegExp;
  /** Common fix for this pattern */
  suggestedFix?: string;
  /** Lines to capture after the match for context */
  contextLines?: number;
}

const ERROR_PATTERNS: ErrorPattern[] = [
  // TypeScript/JavaScript Errors
  {
    name: "TypeScript Compilation Error",
    category: "compilation",
    language: "typescript",
    pattern: /error TS(\d+):\s*(.+)/,
    locationPattern: /(.+\.tsx?):(\d+):(\d+)/,
    contextLines: 3,
  },
  {
    name: "TypeScript Type Error",
    category: "type",
    language: "typescript",
    pattern: /Type '(.+)' is not assignable to type '(.+)'/,
    suggestedFix: "Check type compatibility or add proper type assertion",
  },
  {
    name: "Module Not Found",
    category: "dependency",
    language: "typescript",
    pattern: /Cannot find module '([^']+)'/,
    suggestedFix: "Install the missing package with: bun add <package>",
  },
  {
    name: "Property Does Not Exist",
    category: "type",
    language: "typescript",
    pattern: /Property '([^']+)' does not exist on type '([^']+)'/,
    suggestedFix: "Add the property to the type definition or use optional chaining",
  },
  {
    name: "Bun/Node Runtime Error",
    category: "runtime",
    language: "typescript",
    pattern: /(ReferenceError|TypeError|SyntaxError|RangeError):\s*(.+)/,
    contextLines: 5,
  },
  {
    name: "ESM Import Error",
    category: "dependency",
    language: "typescript",
    pattern: /SyntaxError: Cannot use import statement outside a module/,
    suggestedFix: "Add \"type\": \"module\" to package.json or use .mjs extension",
  },

  // Rust Errors
  {
    name: "Rust Compilation Error",
    category: "compilation",
    language: "rust",
    pattern: /error\[E(\d+)\]:\s*(.+)/,
    locationPattern: /-->\s*(.+\.rs):(\d+):(\d+)/,
    contextLines: 5,
  },
  {
    name: "Rust Borrow Checker Error",
    category: "compilation",
    language: "rust",
    pattern: /cannot borrow `([^`]+)` as (.+) because (.+)/,
    suggestedFix: "Review ownership - consider using .clone(), Rc, or restructuring",
  },
  {
    name: "Rust Trait Not Implemented",
    category: "type",
    language: "rust",
    pattern: /the trait `([^`]+)` is not implemented for `([^`]+)`/,
    suggestedFix: "Implement the required trait or use a different type",
  },
  {
    name: "Cargo Dependency Error",
    category: "dependency",
    language: "rust",
    pattern: /error: failed to select a version for the requirement `([^`]+)`/,
    suggestedFix: "Check Cargo.toml for version conflicts",
  },
  {
    name: "Rust Panic",
    category: "runtime",
    language: "rust",
    pattern: /thread '([^']+)' panicked at (.+)/,
    contextLines: 5,
  },

  // Python Errors
  {
    name: "Python Traceback",
    category: "runtime",
    language: "python",
    pattern: /Traceback \(most recent call last\):/,
    contextLines: 10,
  },
  {
    name: "Python Exception",
    category: "runtime",
    language: "python",
    pattern: /(ImportError|ModuleNotFoundError|AttributeError|ValueError|KeyError|IndexError|TypeError|NameError):\s*(.+)/,
    contextLines: 3,
  },
  {
    name: "Python Import Error",
    category: "dependency",
    language: "python",
    pattern: /No module named '([^']+)'/,
    suggestedFix: "Install with: uv add <package>",
  },
  {
    name: "Python Syntax Error",
    category: "syntax",
    language: "python",
    pattern: /SyntaxError:\s*(.+)/,
    locationPattern: /File "([^"]+)", line (\d+)/,
  },

  // Go Errors
  {
    name: "Go Compilation Error",
    category: "compilation",
    language: "go",
    pattern: /(.+\.go):(\d+):(\d+): (.+)/,
  },
  {
    name: "Go Import Error",
    category: "dependency",
    language: "go",
    pattern: /cannot find package "([^"]+)"/,
    suggestedFix: "Run: go get <package>",
  },
  {
    name: "Go Panic",
    category: "runtime",
    language: "go",
    pattern: /panic:\s*(.+)/,
    contextLines: 5,
  },

  // Shell/Generic Errors
  {
    name: "Command Not Found",
    category: "dependency",
    language: "shell",
    pattern: /command not found:\s*(.+)|(.+): command not found/,
    suggestedFix: "Install the command or check PATH",
  },
  {
    name: "Permission Denied",
    category: "permission",
    language: "shell",
    pattern: /permission denied/i,
    suggestedFix: "Check file permissions with ls -la, use chmod if needed",
  },
  {
    name: "No Such File or Directory",
    category: "runtime",
    language: "shell",
    pattern: /no such file or directory:\s*(.+)|(.+): No such file or directory/i,
    suggestedFix: "Verify the path exists, check for typos",
  },
  {
    name: "Exit Code Error",
    category: "runtime",
    language: "shell",
    pattern: /exited with (code|status) (\d+)/i,
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Error Detection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse scrollback content for errors.
 */
export function detectErrors(scrollback: string): DetectedError[] {
  const lines = scrollback.split("\n");
  const errors: DetectedError[] = [];
  const seenMessages = new Set<string>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    for (const pattern of ERROR_PATTERNS) {
      const match = line.match(pattern.pattern);
      if (!match) continue;

      // Extract message
      const message = match[1] || match[2] || line.trim();

      // Skip duplicates
      const msgKey = `${pattern.name}:${message}`;
      if (seenMessages.has(msgKey)) continue;
      seenMessages.add(msgKey);

      // Extract location if pattern provides it
      let filePath: string | undefined;
      let lineNumber: number | undefined;
      let columnNumber: number | undefined;

      if (pattern.locationPattern) {
        // Check current and surrounding lines for location
        for (let j = Math.max(0, i - 2); j < Math.min(lines.length, i + 3); j++) {
          const locMatch = lines[j].match(pattern.locationPattern);
          if (locMatch) {
            filePath = locMatch[1];
            lineNumber = parseInt(locMatch[2], 10);
            columnNumber = locMatch[3] ? parseInt(locMatch[3], 10) : undefined;
            break;
          }
        }
      }

      // Capture context lines
      const contextStart = i;
      const contextEnd = Math.min(lines.length, i + (pattern.contextLines || 1));
      const fullText = lines.slice(contextStart, contextEnd).join("\n");

      // Extract stack trace for runtime errors
      let stackTrace: string | undefined;
      if (pattern.category === "runtime") {
        const stackLines: string[] = [];
        for (let j = i + 1; j < lines.length && j < i + 15; j++) {
          const stackLine = lines[j];
          if (stackLine.match(/^\s+at\s|^\s+File\s|^\s+\d+\s*\|/)) {
            stackLines.push(stackLine);
          } else if (stackLines.length > 0 && !stackLine.trim()) {
            break;
          }
        }
        if (stackLines.length > 0) {
          stackTrace = stackLines.join("\n");
        }
      }

      errors.push({
        category: pattern.category,
        language: pattern.language,
        message,
        fullText,
        filePath,
        lineNumber,
        columnNumber,
        stackTrace,
        suggestedFix: pattern.suggestedFix,
        confidence: 0.8,
      });

      // Skip ahead to avoid matching same error multiple times
      i += (pattern.contextLines || 1) - 1;
      break;
    }
  }

  return errors;
}

// ─────────────────────────────────────────────────────────────────────────────
// Gotcha Note Creation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate gotcha note content from detected error.
 */
function generateGotchaNoteContent(error: DetectedError): string {
  const parts: string[] = [];

  // Header with error type
  parts.push(`**${error.language.toUpperCase()} ${error.category} error**\n`);

  // Main message
  parts.push(`Error: ${error.message}\n`);

  // Location if available
  if (error.filePath) {
    const location = error.lineNumber
      ? `${error.filePath}:${error.lineNumber}${error.columnNumber ? `:${error.columnNumber}` : ""}`
      : error.filePath;
    parts.push(`Location: \`${location}\`\n`);
  }

  // Full error context
  parts.push("```");
  parts.push(error.fullText);
  parts.push("```\n");

  // Stack trace if available
  if (error.stackTrace) {
    parts.push("**Stack trace:**");
    parts.push("```");
    parts.push(error.stackTrace);
    parts.push("```\n");
  }

  // Suggested fix
  if (error.suggestedFix) {
    parts.push(`**Suggested fix:** ${error.suggestedFix}`);
  }

  return parts.join("\n");
}

/**
 * Generate gotcha note title from error.
 */
function generateGotchaNoteTitle(error: DetectedError): string {
  const prefix = error.language === "unknown" ? "" : `[${error.language}] `;
  const message = error.message.slice(0, 80);
  return `${prefix}${message}${error.message.length > 80 ? "..." : ""}`;
}

/**
 * Check if a similar gotcha note already exists.
 */
async function findExistingNote(
  userId: string,
  errorMessage: string,
  folderId?: string
): Promise<boolean> {
  // Check for notes with similar content in the last 24 hours
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const existing = await db.query.sdkNotes.findFirst({
    where: (notes, { and, eq, like, gt }) =>
      and(
        eq(notes.userId, userId),
        eq(notes.type, "gotcha"),
        like(notes.content, `%${errorMessage.slice(0, 50)}%`),
        gt(notes.createdAt, oneDayAgo),
        folderId ? eq(notes.folderId, folderId) : undefined
      ),
  });

  return existing !== undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Service
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Process scrollback and automatically create gotcha notes for errors.
 *
 * @param userId - User ID for note ownership
 * @param scrollback - Terminal scrollback content
 * @param sessionId - Optional session ID to link note
 * @param folderId - Optional folder ID to link note
 * @returns Result with created note IDs and statistics
 */
export async function autoCapturErrors(
  userId: string,
  scrollback: string,
  sessionId?: string,
  folderId?: string
): Promise<AutoCaptureResult> {
  const errors = detectErrors(scrollback);
  const noteIds: string[] = [];
  let duplicatesSkipped = 0;

  for (const error of errors) {
    // Check for duplicates
    const exists = await findExistingNote(userId, error.message, folderId);
    if (exists) {
      duplicatesSkipped++;
      continue;
    }

    // Create gotcha note
    const content = generateGotchaNoteContent(error);
    const title = generateGotchaNoteTitle(error);

    const [note] = await db
      .insert(sdkNotes)
      .values({
        userId,
        sessionId: sessionId || null,
        folderId: folderId || null,
        type: "gotcha" as NoteType,
        title,
        content,
        tagsJson: JSON.stringify([
          error.language,
          error.category,
          "auto-captured",
        ]),
        contextJson: JSON.stringify({
          source: "error-auto-capture",
          error: {
            category: error.category,
            language: error.language,
            filePath: error.filePath,
            lineNumber: error.lineNumber,
            confidence: error.confidence,
          },
        }),
        priority: error.category === "compilation" ? 0.8 : 0.6,
        pinned: false,
        archived: false,
      })
      .returning();

    noteIds.push(note.id);
  }

  return {
    errors,
    noteIds,
    duplicatesSkipped,
  };
}

/**
 * Get supported languages for error detection.
 */
export function getSupportedLanguages(): DetectedError["language"][] {
  return ["typescript", "rust", "python", "go", "shell"];
}

/**
 * Get error categories.
 */
export function getErrorCategories(): DetectedError["category"][] {
  return ["compilation", "runtime", "permission", "dependency", "syntax", "type"];
}
