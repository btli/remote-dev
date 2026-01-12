"use client";

/**
 * CodePreview - Syntax highlighted code preview with line numbers
 *
 * Features:
 * - Syntax highlighting for multiple languages
 * - Line numbers with click-to-select
 * - Copy to clipboard
 * - Expandable modal for large files
 * - Diff mode support
 *
 * Based on arXiv 2512.10398v5 UX patterns for artifact visualization.
 */

import { useState, useMemo, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Copy,
  Check,
  Maximize2,
  FileCode,
  Download,
  WrapText,
  Hash,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type SupportedLanguage =
  | "javascript"
  | "typescript"
  | "python"
  | "rust"
  | "go"
  | "java"
  | "c"
  | "cpp"
  | "csharp"
  | "ruby"
  | "php"
  | "swift"
  | "kotlin"
  | "html"
  | "css"
  | "json"
  | "yaml"
  | "markdown"
  | "sql"
  | "bash"
  | "shell"
  | "diff"
  | "text";

interface CodePreviewProps {
  /** Code content to display */
  code: string;
  /** Programming language for syntax highlighting */
  language?: SupportedLanguage;
  /** File name for display */
  filename?: string;
  /** Maximum lines to show before collapsing */
  maxLines?: number;
  /** Show line numbers */
  showLineNumbers?: boolean;
  /** Enable word wrap */
  wordWrap?: boolean;
  /** Highlighted line numbers (1-indexed) */
  highlightLines?: number[];
  /** Selected line range [start, end] */
  selectedRange?: [number, number];
  /** Called when line is clicked */
  onLineClick?: (lineNumber: number) => void;
  /** Additional CSS class */
  className?: string;
  /** Mode: inline, panel, or dialog */
  mode?: "inline" | "panel" | "dialog";
  /** Trigger for dialog mode */
  trigger?: React.ReactNode;
}

// ─────────────────────────────────────────────────────────────────────────────
// Syntax Highlighting (Simple Token-Based)
// ─────────────────────────────────────────────────────────────────────────────

interface Token {
  type: "keyword" | "string" | "comment" | "number" | "operator" | "function" | "type" | "text";
  value: string;
}

const KEYWORD_PATTERNS: Record<string, RegExp> = {
  javascript: /\b(const|let|var|function|return|if|else|for|while|class|import|export|default|from|async|await|try|catch|throw|new|this|null|undefined|true|false)\b/g,
  typescript: /\b(const|let|var|function|return|if|else|for|while|class|import|export|default|from|async|await|try|catch|throw|new|this|null|undefined|true|false|type|interface|enum|implements|extends|readonly|private|public|protected|static|abstract)\b/g,
  python: /\b(def|class|if|elif|else|for|while|try|except|finally|with|as|import|from|return|yield|raise|pass|break|continue|lambda|and|or|not|in|is|None|True|False|self|async|await)\b/g,
  rust: /\b(fn|let|mut|const|struct|enum|impl|trait|pub|use|mod|self|super|crate|match|if|else|for|while|loop|return|break|continue|async|await|move|ref|where|type|dyn|impl|Box|Option|Result|Some|None|Ok|Err|true|false)\b/g,
  go: /\b(func|var|const|type|struct|interface|package|import|return|if|else|for|range|switch|case|default|go|select|chan|map|make|new|nil|true|false|defer|panic|recover)\b/g,
  java: /\b(class|interface|enum|public|private|protected|static|final|abstract|void|int|long|float|double|boolean|char|byte|short|String|new|return|if|else|for|while|try|catch|throw|throws|import|package|extends|implements|this|super|null|true|false)\b/g,
  bash: /\b(if|then|else|elif|fi|for|in|do|done|while|until|case|esac|function|return|local|export|source|echo|read|exit|test)\b/g,
  sql: /\b(SELECT|FROM|WHERE|INSERT|INTO|UPDATE|DELETE|CREATE|TABLE|DROP|ALTER|INDEX|JOIN|LEFT|RIGHT|INNER|OUTER|ON|AND|OR|NOT|NULL|ORDER|BY|GROUP|HAVING|LIMIT|OFFSET|AS|DISTINCT|UNION|ALL|VALUES|SET|PRIMARY|KEY|FOREIGN|REFERENCES|CASCADE)\b/gi,
};

const TYPE_PATTERNS: Record<string, RegExp> = {
  typescript: /\b(string|number|boolean|void|any|unknown|never|object|Array|Promise|Map|Set|Record)\b/g,
  rust: /\b(i8|i16|i32|i64|i128|isize|u8|u16|u32|u64|u128|usize|f32|f64|bool|char|str|String|Vec|HashMap|HashSet)\b/g,
  java: /\b(String|Integer|Long|Float|Double|Boolean|Character|Byte|Short|Object|List|Map|Set|ArrayList|HashMap|HashSet)\b/g,
};

function tokenize(code: string, language: SupportedLanguage): Token[][] {
  const lines = code.split("\n");

  return lines.map((line) => {
    const tokens: Token[] = [];
    let remaining = line;
    let position = 0;

    while (remaining.length > 0) {
      // Check for comments
      if (remaining.startsWith("//") || remaining.startsWith("#")) {
        tokens.push({ type: "comment", value: remaining });
        break;
      }

      // Check for multi-character operators
      const opMatch = remaining.match(/^(===|!==|==|!=|<=|>=|=>|->|\+\+|--|&&|\|\||<<|>>)/);
      if (opMatch) {
        tokens.push({ type: "operator", value: opMatch[0] });
        remaining = remaining.slice(opMatch[0].length);
        continue;
      }

      // Check for strings
      const stringMatch = remaining.match(/^(["'`])(?:[^\\]|\\.)*?\1/);
      if (stringMatch) {
        tokens.push({ type: "string", value: stringMatch[0] });
        remaining = remaining.slice(stringMatch[0].length);
        continue;
      }

      // Check for numbers
      const numMatch = remaining.match(/^-?\d+\.?\d*(e[+-]?\d+)?/i);
      if (numMatch && (position === 0 || /[\s\(\[\{,;:=<>!&|+\-*/%]/.test(line[position - 1] || ""))) {
        tokens.push({ type: "number", value: numMatch[0] });
        remaining = remaining.slice(numMatch[0].length);
        position += numMatch[0].length;
        continue;
      }

      // Check for keywords
      const keywordPattern = KEYWORD_PATTERNS[language];
      if (keywordPattern) {
        const keywordMatch = remaining.match(/^[a-zA-Z_][a-zA-Z0-9_]*/);
        if (keywordMatch) {
          const word = keywordMatch[0];
          const isKeyword = keywordPattern.source.includes(`\\b${word}\\b`) ||
            (language === "sql" && new RegExp(`\\b${word}\\b`, "i").test(word));

          // Check if it's a type
          const typePattern = TYPE_PATTERNS[language];
          const isType = typePattern && new RegExp(`\\b${word}\\b`).test(word);

          // Check if it's a function (followed by parenthesis)
          const isFunction = remaining.slice(word.length).trimStart().startsWith("(");

          if (isType) {
            tokens.push({ type: "type", value: word });
          } else if (isKeyword) {
            tokens.push({ type: "keyword", value: word });
          } else if (isFunction) {
            tokens.push({ type: "function", value: word });
          } else {
            tokens.push({ type: "text", value: word });
          }
          remaining = remaining.slice(word.length);
          position += word.length;
          continue;
        }
      }

      // Single-character operators
      if (/^[+\-*/%=<>!&|^~?:;,.\(\)\[\]\{\}]/.test(remaining[0])) {
        tokens.push({ type: "operator", value: remaining[0] });
        remaining = remaining.slice(1);
        position++;
        continue;
      }

      // Default: take one character as text
      const wordMatch = remaining.match(/^[a-zA-Z_][a-zA-Z0-9_]*/);
      if (wordMatch) {
        tokens.push({ type: "text", value: wordMatch[0] });
        remaining = remaining.slice(wordMatch[0].length);
        position += wordMatch[0].length;
      } else {
        tokens.push({ type: "text", value: remaining[0] });
        remaining = remaining.slice(1);
        position++;
      }
    }

    return tokens;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Token Colors
// ─────────────────────────────────────────────────────────────────────────────

const TOKEN_COLORS: Record<Token["type"], string> = {
  keyword: "text-purple-400",
  string: "text-green-400",
  comment: "text-gray-500 italic",
  number: "text-orange-400",
  operator: "text-cyan-400",
  function: "text-yellow-400",
  type: "text-blue-400",
  text: "text-foreground",
};

// ─────────────────────────────────────────────────────────────────────────────
// Language Detection
// ─────────────────────────────────────────────────────────────────────────────

const EXTENSION_MAP: Record<string, SupportedLanguage> = {
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".ts": "typescript",
  ".tsx": "typescript",
  ".py": "python",
  ".rs": "rust",
  ".go": "go",
  ".java": "java",
  ".c": "c",
  ".h": "c",
  ".cpp": "cpp",
  ".cc": "cpp",
  ".hpp": "cpp",
  ".cs": "csharp",
  ".rb": "ruby",
  ".php": "php",
  ".swift": "swift",
  ".kt": "kotlin",
  ".html": "html",
  ".htm": "html",
  ".css": "css",
  ".scss": "css",
  ".sass": "css",
  ".json": "json",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".md": "markdown",
  ".sql": "sql",
  ".sh": "bash",
  ".bash": "bash",
  ".zsh": "bash",
  ".diff": "diff",
  ".patch": "diff",
};

export function detectLanguage(filename?: string): SupportedLanguage {
  if (!filename) return "text";

  const ext = filename.slice(filename.lastIndexOf("."));
  return EXTENSION_MAP[ext.toLowerCase()] || "text";
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

export function CodePreview({
  code,
  language,
  filename,
  maxLines = 50,
  showLineNumbers = true,
  wordWrap: initialWordWrap = false,
  highlightLines = [],
  selectedRange,
  onLineClick,
  className,
  mode = "inline",
  trigger,
}: CodePreviewProps) {
  // State
  const [copied, setCopied] = useState(false);
  const [wordWrap, setWordWrap] = useState(initialWordWrap);
  const [showNumbers, setShowNumbers] = useState(showLineNumbers);
  const [dialogOpen, setDialogOpen] = useState(false);

  // Detect language if not provided
  const detectedLanguage = language || detectLanguage(filename);

  // Tokenize code
  const lines = useMemo(() => code.split("\n"), [code]);
  const tokenizedLines = useMemo(
    () => tokenize(code, detectedLanguage),
    [code, detectedLanguage]
  );

  // Determine if truncated
  const isTruncated = lines.length > maxLines;
  const visibleTokens = isTruncated
    ? tokenizedLines.slice(0, maxLines)
    : tokenizedLines;

  // Copy handler
  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [code]);

  // Download handler
  const handleDownload = useCallback(() => {
    const blob = new Blob([code], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename || `code.${detectedLanguage}`;
    a.click();
    URL.revokeObjectURL(url);
  }, [code, filename, detectedLanguage]);

  // Line highlight check
  const isLineHighlighted = useCallback(
    (lineNum: number) => {
      if (highlightLines.includes(lineNum)) return true;
      if (selectedRange) {
        return lineNum >= selectedRange[0] && lineNum <= selectedRange[1];
      }
      return false;
    },
    [highlightLines, selectedRange]
  );

  // Render line
  const renderLine = useCallback(
    (tokens: Token[], lineNum: number) => (
      <div
        key={lineNum}
        className={cn(
          "flex",
          isLineHighlighted(lineNum) && "bg-yellow-500/10",
          onLineClick && "cursor-pointer hover:bg-muted/50"
        )}
        onClick={() => onLineClick?.(lineNum)}
      >
        {showNumbers && (
          <span
            className={cn(
              "w-12 flex-shrink-0 px-2 py-0.5 text-right select-none",
              "text-muted-foreground border-r border-border",
              isLineHighlighted(lineNum) && "text-yellow-400"
            )}
          >
            {lineNum}
          </span>
        )}
        <code
          className={cn(
            "flex-1 px-3 py-0.5",
            wordWrap ? "whitespace-pre-wrap break-all" : "whitespace-pre"
          )}
        >
          {tokens.length === 0 ? "\n" : tokens.map((token, i) => (
            <span key={i} className={TOKEN_COLORS[token.type]}>
              {token.value}
            </span>
          ))}
        </code>
      </div>
    ),
    [showNumbers, wordWrap, isLineHighlighted, onLineClick]
  );

  // Toolbar
  const toolbar = (
    <div className="flex items-center gap-1 px-3 py-2 border-b border-border bg-muted/30">
      {filename && (
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <FileCode className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          <span className="text-sm font-medium truncate">{filename}</span>
          <Badge variant="outline" className="text-[10px]">
            {detectedLanguage}
          </Badge>
        </div>
      )}

      {!filename && (
        <Badge variant="outline" className="text-[10px]">
          {detectedLanguage}
        </Badge>
      )}

      <div className="flex items-center gap-1 ml-auto">
        {/* Toggle line numbers */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={showNumbers ? "secondary" : "ghost"}
              size="icon"
              className="h-7 w-7"
              onClick={() => setShowNumbers(!showNumbers)}
            >
              <Hash className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Toggle line numbers</TooltipContent>
        </Tooltip>

        {/* Toggle word wrap */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={wordWrap ? "secondary" : "ghost"}
              size="icon"
              className="h-7 w-7"
              onClick={() => setWordWrap(!wordWrap)}
            >
              <WrapText className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Toggle word wrap</TooltipContent>
        </Tooltip>

        {/* Copy */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={handleCopy}
            >
              {copied ? (
                <Check className="h-3.5 w-3.5 text-green-400" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{copied ? "Copied!" : "Copy code"}</TooltipContent>
        </Tooltip>

        {/* Download */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={handleDownload}
            >
              <Download className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Download file</TooltipContent>
        </Tooltip>

        {/* Expand (inline mode only) */}
        {mode === "inline" && isTruncated && (
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7">
                <Maximize2 className="h-3.5 w-3.5" />
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-4xl h-[80vh] flex flex-col p-0">
              <DialogHeader className="px-4 pt-4 pb-0">
                <DialogTitle className="flex items-center gap-2">
                  <FileCode className="h-5 w-5" />
                  {filename || "Code Preview"}
                </DialogTitle>
              </DialogHeader>
              <ScrollArea className="flex-1">
                <div className="font-mono text-sm">
                  {tokenizedLines.map((tokens, i) => renderLine(tokens, i + 1))}
                </div>
              </ScrollArea>
            </DialogContent>
          </Dialog>
        )}
      </div>
    </div>
  );

  // Code content
  const content = (
    <ScrollArea
      className="max-h-[500px]"
      style={{ maxHeight: mode === "panel" ? undefined : "500px" }}
    >
      <div className={cn("font-mono text-sm", !wordWrap && "overflow-x-auto")}>
        {visibleTokens.map((tokens, i) => renderLine(tokens, i + 1))}

        {isTruncated && mode === "inline" && (
          <div className="px-3 py-2 text-center text-muted-foreground text-sm border-t border-border bg-muted/20">
            +{lines.length - maxLines} more lines
            <Button
              variant="link"
              size="sm"
              className="ml-2 h-auto p-0"
              onClick={() => setDialogOpen(true)}
            >
              Show all
            </Button>
          </div>
        )}
      </div>
    </ScrollArea>
  );

  // Render based on mode
  if (mode === "dialog") {
    return (
      <Dialog>
        <DialogTrigger asChild>
          {trigger || (
            <Button variant="outline" size="sm">
              <FileCode className="h-4 w-4 mr-2" />
              View Code
            </Button>
          )}
        </DialogTrigger>
        <DialogContent className="max-w-4xl h-[80vh] flex flex-col p-0">
          <DialogHeader className="px-4 pt-4 pb-0">
            <DialogTitle className="flex items-center gap-2">
              <FileCode className="h-5 w-5" />
              {filename || "Code Preview"}
            </DialogTitle>
          </DialogHeader>
          {toolbar}
          <ScrollArea className="flex-1">
            <div className="font-mono text-sm">
              {tokenizedLines.map((tokens, i) => renderLine(tokens, i + 1))}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    );
  }

  // Inline or panel mode
  return (
    <div
      className={cn(
        "border border-border rounded-lg overflow-hidden bg-background",
        className
      )}
    >
      {toolbar}
      {content}
    </div>
  );
}

export default CodePreview;
