/**
 * Error Auto-Capture Service
 *
 * Automatically detects compilation and runtime errors from terminal scrollback
 * and creates gotcha notes for learning and future reference.
 *
 * Features:
 * - Multi-language error detection (TypeScript, Rust, Python, Go, shell)
 * - Automatic gotcha note creation for new errors
 * - Similar error retrieval via semantic search
 * - Context injection with known resolutions
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
import { callRdvServer, isRdvServerAvailable } from "@/lib/rdv-proxy";

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
  /** Similar gotchas found for retrieval (when using findSimilarGotchas) */
  similarGotchas?: SimilarGotcha[];
}

/** A similar gotcha found via semantic search */
export interface SimilarGotcha {
  /** Gotcha note ID */
  id: string;
  /** Title of the gotcha */
  title: string;
  /** Content with resolution */
  content: string;
  /** Semantic similarity score (0-1) */
  score: number;
  /** Source session ID if available */
  sessionId?: string;
  /** When the gotcha was created */
  createdAt: string;
  /** Confidence in the match */
  confidence: number;
}

/** Context for injection into a session */
export interface GotchaContext {
  /** Formatted system reminder for injection */
  systemReminder: string;
  /** Number of similar gotchas found */
  matchCount: number;
  /** The similar gotchas */
  gotchas: SimilarGotcha[];
}

/** Semantic search response from rdv-server */
interface SemanticSearchResponse {
  results: Array<{
    memory: {
      id: string;
      tier: string;
      contentType: string;
      content: string;
      name: string | null;
      relevance: number | null;
      confidence: number | null;
      folderId: string | null;
    };
    score: number;
    semanticScore: number;
    tierWeight: number;
    typeWeight: number;
  }>;
  query: string;
  total: number;
  semantic: boolean;
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
// Similar Gotcha Retrieval (Semantic Search)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a semantic search query from a detected error.
 *
 * The query combines language, category, and error message to find
 * similar gotchas from past sessions.
 */
function buildErrorQuery(error: DetectedError): string {
  const parts: string[] = [];

  // Add language context
  if (error.language !== "unknown") {
    parts.push(error.language);
  }

  // Add error category
  parts.push(error.category);

  // Add error message (truncated for embedding efficiency)
  const message = error.message.slice(0, 200);
  parts.push(message);

  // Add file context if available (just the extension)
  if (error.filePath) {
    const ext = error.filePath.split(".").pop();
    if (ext) {
      parts.push(ext);
    }
  }

  return parts.join(" ");
}

/**
 * Search for similar gotchas using semantic search.
 *
 * @param userId - User ID for scoping the search
 * @param error - The detected error to find similar gotchas for
 * @param folderId - Optional folder ID to scope the search
 * @param minSimilarity - Minimum similarity threshold (default: 0.75)
 * @param limit - Maximum results to return (default: 3)
 * @returns Array of similar gotchas or empty array if unavailable
 */
export async function findSimilarGotchas(
  userId: string,
  error: DetectedError,
  folderId?: string,
  minSimilarity: number = 0.75,
  limit: number = 3
): Promise<SimilarGotcha[]> {
  // Check if rdv-server is available
  const available = await isRdvServerAvailable();
  if (!available) {
    return [];
  }

  // Build semantic search query
  const query = buildErrorQuery(error);

  try {
    const result = await callRdvServer<SemanticSearchResponse>(
      "POST",
      "/memory/semantic-search",
      userId,
      {
        query,
        folderId: folderId || null,
        tiers: ["long_term", "working"],
        contentTypes: ["gotcha"],
        minSimilarity,
        limit,
      }
    );

    if ("error" in result) {
      console.error("[error-auto-capture] Semantic search failed:", result.error);
      return [];
    }

    // Map results to SimilarGotcha format
    return result.data.results.map((r) => ({
      id: r.memory.id,
      title: r.memory.name || "Untitled gotcha",
      content: r.memory.content,
      score: r.score,
      confidence: r.memory.confidence || 0.8,
      createdAt: new Date().toISOString(), // Note: rdv-server should return this
    }));
  } catch (error) {
    console.error("[error-auto-capture] Error searching for similar gotchas:", error);
    return [];
  }
}

/**
 * Search for similar gotchas for multiple errors in parallel.
 *
 * @param userId - User ID for scoping the search
 * @param errors - Array of detected errors
 * @param folderId - Optional folder ID to scope the search
 * @returns Map of error index to similar gotchas
 */
export async function findSimilarGotchasForErrors(
  userId: string,
  errors: DetectedError[],
  folderId?: string
): Promise<Map<number, SimilarGotcha[]>> {
  const results = new Map<number, SimilarGotcha[]>();

  // Search in parallel for all errors
  const searches = errors.map((error, index) =>
    findSimilarGotchas(userId, error, folderId).then((gotchas) => ({
      index,
      gotchas,
    }))
  );

  const searchResults = await Promise.all(searches);

  for (const { index, gotchas } of searchResults) {
    if (gotchas.length > 0) {
      results.set(index, gotchas);
    }
  }

  return results;
}

/**
 * Format similar gotchas as a system reminder for injection.
 *
 * @param error - The detected error
 * @param gotchas - Similar gotchas found
 * @returns Formatted context for injection
 */
export function formatGotchaContext(
  error: DetectedError,
  gotchas: SimilarGotcha[]
): GotchaContext {
  if (gotchas.length === 0) {
    return {
      systemReminder: "",
      matchCount: 0,
      gotchas: [],
    };
  }

  const parts: string[] = [];
  parts.push("<system-reminder>");
  parts.push("Similar error found in past sessions:\n");

  for (const gotcha of gotchas) {
    parts.push(`## Known Issue: ${gotcha.title}`);
    parts.push(`**Resolution:**`);
    parts.push(gotcha.content);
    parts.push("");
    parts.push(`**Confidence:** ${Math.round(gotcha.confidence * 100)}%`);
    parts.push(`**Similarity:** ${Math.round(gotcha.score * 100)}%`);
    parts.push("");
  }

  parts.push("</system-reminder>");

  return {
    systemReminder: parts.join("\n"),
    matchCount: gotchas.length,
    gotchas,
  };
}

/**
 * Process an error and retrieve similar gotchas for context injection.
 *
 * This is the main entry point for error-to-gotcha retrieval.
 * It detects errors, searches for similar gotchas, and formats
 * the context for injection into the session.
 *
 * @param userId - User ID for scoping
 * @param error - The detected error
 * @param folderId - Optional folder ID
 * @returns Context for injection, or null if no similar gotchas found
 */
export async function getGotchaContextForError(
  userId: string,
  error: DetectedError,
  folderId?: string
): Promise<GotchaContext | null> {
  const gotchas = await findSimilarGotchas(userId, error, folderId);

  if (gotchas.length === 0) {
    return null;
  }

  return formatGotchaContext(error, gotchas);
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
 * Extended auto-capture with similar gotcha retrieval.
 *
 * This function:
 * 1. Detects errors in scrollback
 * 2. Searches for similar gotchas for each error
 * 3. Creates new gotcha notes for errors without matches
 * 4. Returns both the created notes and found similar gotchas
 *
 * Use this when you want to both capture new errors AND retrieve
 * known resolutions from past sessions.
 *
 * @param userId - User ID for note ownership and search scoping
 * @param scrollback - Terminal scrollback content
 * @param sessionId - Optional session ID to link note
 * @param folderId - Optional folder ID to link note
 * @returns Result with created notes, statistics, and similar gotchas
 */
export async function autoCaptureErrorsWithRetrieval(
  userId: string,
  scrollback: string,
  sessionId?: string,
  folderId?: string
): Promise<AutoCaptureResult & { gotchaContexts: GotchaContext[] }> {
  const errors = detectErrors(scrollback);
  const noteIds: string[] = [];
  let duplicatesSkipped = 0;
  const gotchaContexts: GotchaContext[] = [];
  const allSimilarGotchas: SimilarGotcha[] = [];

  // Search for similar gotchas in parallel while processing errors
  const similarGotchasMap = await findSimilarGotchasForErrors(userId, errors, folderId);

  for (let i = 0; i < errors.length; i++) {
    const error = errors[i];

    // Check for similar gotchas from semantic search
    const similarGotchas = similarGotchasMap.get(i);
    if (similarGotchas && similarGotchas.length > 0) {
      // Found similar gotchas - format for injection
      const context = formatGotchaContext(error, similarGotchas);
      gotchaContexts.push(context);
      allSimilarGotchas.push(...similarGotchas);
      // Skip creating a new note since similar exists
      duplicatesSkipped++;
      continue;
    }

    // Check for duplicates in local notes
    const exists = await findExistingNote(userId, error.message, folderId);
    if (exists) {
      duplicatesSkipped++;
      continue;
    }

    // Create gotcha note for new errors
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
    similarGotchas: allSimilarGotchas,
    gotchaContexts,
  };
}

/**
 * Process scrollback for errors and return injection context.
 *
 * This is a convenience function that combines error detection
 * with gotcha retrieval, returning formatted context ready
 * for injection into the session.
 *
 * @param userId - User ID for scoping
 * @param scrollback - Terminal scrollback content
 * @param folderId - Optional folder ID
 * @returns Combined context for all errors with similar gotchas
 */
export async function getContextForScrollbackErrors(
  userId: string,
  scrollback: string,
  folderId?: string
): Promise<{
  errors: DetectedError[];
  context: string;
  matchCount: number;
}> {
  const errors = detectErrors(scrollback);

  if (errors.length === 0) {
    return { errors: [], context: "", matchCount: 0 };
  }

  const similarGotchasMap = await findSimilarGotchasForErrors(userId, errors, folderId);

  const parts: string[] = [];
  let totalMatches = 0;

  for (let i = 0; i < errors.length; i++) {
    const gotchas = similarGotchasMap.get(i);
    if (gotchas && gotchas.length > 0) {
      const context = formatGotchaContext(errors[i], gotchas);
      parts.push(context.systemReminder);
      totalMatches += gotchas.length;
    }
  }

  return {
    errors,
    context: parts.join("\n\n"),
    matchCount: totalMatches,
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
