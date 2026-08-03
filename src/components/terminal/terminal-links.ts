import type { ILinkProvider } from "@xterm/xterm";

/** Parse an absolute terminal link while enforcing the only protocols we open. */
export function parseHttpUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

type OpenWindow = (
  url?: string | URL,
  target?: string,
  features?: string,
) => Window | null;

/** Create the shared opener used by OSC 8, inferred links, and WebLinksAddon. */
export function createHttpLinkOpener(
  openWindow: OpenWindow = window.open.bind(window),
): (value: string) => boolean {
  return (value) => {
    const url = parseHttpUrl(value);
    if (!url) return false;
    return openWindow(url.href, "_blank", "noopener,noreferrer") !== null;
  };
}

export interface TerminalLinkCellSnapshot {
  readonly chars: string;
  readonly width: number;
}

export interface TerminalLinkRowSnapshot {
  /** Zero-based absolute buffer row. */
  readonly index: number;
  readonly isWrapped: boolean;
  readonly cells: readonly TerminalLinkCellSnapshot[];
}

export interface TerminalLinkCandidate {
  readonly text: string;
  readonly range: {
    readonly start: { readonly x: number; readonly y: number };
    readonly end: { readonly x: number; readonly y: number };
  };
  readonly requiresConfirmation: boolean;
}

interface ContentBounds {
  start: number;
  end: number;
  leftBorder?: { column: number; chars: string };
  rightBorder?: { column: number; chars: string };
}

interface RowConnection {
  kind: "soft" | "hard";
  previousEnd: number;
  nextStart: number;
}

interface MappedCodeUnit {
  row: number;
  startX: number;
  endX: number;
}

interface AssembledGroup {
  text: string;
  mapping: MappedCodeUnit[];
  boundaries: Array<{ index: number; kind: "soft" | "hard" }>;
}

const BORDER_CHARS = new Set(["│", "┃", "║", "|"]);
const URL_START = /https?:\/\//gi;
const URL_STOP = /[\s"'!*(){}|\\^<>`]/u;
const URL_TRAILING_PUNCTUATION = /[,:.!?;\]}>)]+$/u;

function isBlankCell(cell: TerminalLinkCellSnapshot | undefined): boolean {
  return !cell || cell.width === 0 || cell.chars === "" || /^\s+$/u.test(cell.chars);
}

function contentBounds(row: TerminalLinkRowSnapshot): ContentBounds {
  let first = 0;
  while (first < row.cells.length && isBlankCell(row.cells[first])) first++;

  let last = row.cells.length - 1;
  while (last >= first && isBlankCell(row.cells[last])) last--;

  const bounds: ContentBounds = {
    start: first,
    end: row.cells.length,
  };

  const midpoint = Math.floor(row.cells.length / 2);
  let leftBorderColumn = -1;
  for (let column = first; column <= midpoint; column++) {
    const chars = row.cells[column]?.chars;
    if (
      chars &&
      BORDER_CHARS.has(chars) &&
      (column === first || isBlankCell(row.cells[column + 1]))
    ) {
      // The delimiter closest to content wins over a label outside it.
      leftBorderColumn = column;
    }
  }
  if (leftBorderColumn >= 0) {
    bounds.leftBorder = {
      column: leftBorderColumn,
      chars: row.cells[leftBorderColumn]!.chars,
    };
    bounds.start = leftBorderColumn + 1;
    while (bounds.start < row.cells.length && isBlankCell(row.cells[bounds.start])) {
      bounds.start++;
    }
  }

  let rightBorderColumn = -1;
  for (let column = midpoint + 1; column <= last; column++) {
    const chars = row.cells[column]?.chars;
    if (
      chars &&
      BORDER_CHARS.has(chars) &&
      (column === last || isBlankCell(row.cells[column - 1]))
    ) {
      // The first delimiter in the right half is the content boundary; text
      // after it is a stable label/suffix rather than link content.
      rightBorderColumn = column;
      break;
    }
  }
  if (rightBorderColumn >= 0 && rightBorderColumn > bounds.start) {
    bounds.rightBorder = {
      column: rightBorderColumn,
      chars: row.cells[rightBorderColumn]!.chars,
    };
    bounds.end = rightBorderColumn;
    // Treat one cell next to a panel border as its stable inner gutter. Any
    // additional spaces remain content padding and cannot imply a wrap.
    if (bounds.end > bounds.start && isBlankCell(row.cells[bounds.end - 1])) {
      bounds.end--;
    }
  }

  return bounds;
}

function lastContentEnd(row: TerminalLinkRowSnapshot, end: number): number {
  let column = Math.min(end, row.cells.length) - 1;
  while (column >= 0 && isBlankCell(row.cells[column])) column--;
  if (column < 0) return 0;
  return column + Math.max(1, row.cells[column]?.width ?? 1);
}

function firstContentColumn(row: TerminalLinkRowSnapshot, start: number): number {
  let column = Math.max(0, start);
  while (column < row.cells.length && isBlankCell(row.cells[column])) column++;
  return column;
}

function matchingHardLayout(
  previous: ContentBounds,
  next: ContentBounds,
): boolean {
  const previousHasBorder = Boolean(previous.leftBorder || previous.rightBorder);
  const nextHasBorder = Boolean(next.leftBorder || next.rightBorder);
  if (previousHasBorder || nextHasBorder) {
    return (
      previous.leftBorder?.column === next.leftBorder?.column &&
      previous.leftBorder?.chars === next.leftBorder?.chars &&
      previous.rightBorder?.column === next.rightBorder?.column &&
      previous.rightBorder?.chars === next.rightBorder?.chars &&
      previous.start === next.start &&
      previous.end === next.end
    );
  }
  return previous.start === next.start && previous.end === next.end;
}

function connectionBetween(
  previous: TerminalLinkRowSnapshot,
  next: TerminalLinkRowSnapshot,
): RowConnection | null {
  if (next.index !== previous.index + 1) return null;

  if (next.isWrapped) {
    let previousEnd = previous.cells.length;
    const contentEnd = lastContentEnd(previous, previousEnd);
    // When a width-2 glyph cannot fit in the final cell, xterm leaves that
    // cell blank and starts the wrapped glyph at column 0 on the next row.
    const hasEarlyWrappedWideGlyph =
      contentEnd === previousEnd - 1 &&
      isBlankCell(previous.cells[previousEnd - 1]) &&
      next.cells[0]?.width === 2;
    if (hasEarlyWrappedWideGlyph) previousEnd--;
    const reachesEdge = contentEnd === previousEnd;
    if (!reachesEdge || firstContentColumn(next, 0) !== 0) return null;
    return { kind: "soft", previousEnd, nextStart: 0 };
  }

  const previousBounds = contentBounds(previous);
  const nextBounds = contentBounds(next);
  if (!matchingHardLayout(previousBounds, nextBounds)) return null;
  if (lastContentEnd(previous, previousBounds.end) !== previousBounds.end) return null;
  if (firstContentColumn(next, nextBounds.start) !== nextBounds.start) return null;
  return {
    kind: "hard",
    previousEnd: previousBounds.end,
    nextStart: nextBounds.start,
  };
}

function appendRowCells(
  group: AssembledGroup,
  row: TerminalLinkRowSnapshot,
  start: number,
  end: number,
): void {
  for (let column = start; column < Math.min(end, row.cells.length); column++) {
    const cell = row.cells[column];
    if (!cell || cell.width === 0) continue;
    const chars = cell.chars || " ";
    for (let offset = 0; offset < chars.length; offset++) {
      group.text += chars[offset];
      group.mapping.push({
        row: row.index,
        startX: column + 1,
        endX: column + Math.max(1, cell.width),
      });
    }
  }
}

function assembleGroups(rows: readonly TerminalLinkRowSnapshot[]): AssembledGroup[] {
  if (rows.length === 0) return [];
  const sortedRows = [...rows].sort((a, b) => a.index - b.index);
  const connections = sortedRows.slice(0, -1).map((row, index) =>
    connectionBetween(row, sortedRows[index + 1]),
  );
  const groups: AssembledGroup[] = [];

  let rowIndex = 0;
  while (rowIndex < sortedRows.length) {
    const group: AssembledGroup = { text: "", mapping: [], boundaries: [] };
    let current = rowIndex;
    while (current < sortedRows.length) {
      const row = sortedRows[current];
      const incoming = current > rowIndex ? connections[current - 1] : null;
      const outgoing = connections[current] ?? null;
      const bounds = contentBounds(row);
      appendRowCells(
        group,
        row,
        incoming?.nextStart ?? bounds.start,
        outgoing?.previousEnd ?? bounds.end,
      );

      if (!outgoing) break;
      group.boundaries.push({ index: group.text.length, kind: outgoing.kind });
      current++;
    }
    groups.push(group);
    rowIndex = current + 1;
  }
  return groups;
}

function shouldCrossHardBoundary(prefix: string, suffix: string): boolean {
  if (!parseHttpUrl(prefix)) return true;
  if (/[/?.#=&%_~-]$/u.test(prefix)) return true;
  return /[/?.#=&%_~-]/u.test(suffix);
}

function linksInGroup(group: AssembledGroup): TerminalLinkCandidate[] {
  const result: TerminalLinkCandidate[] = [];
  URL_START.lastIndex = 0;
  let startMatch: RegExpExecArray | null;
  while ((startMatch = URL_START.exec(group.text))) {
    const start = startMatch.index;
    let end = URL_START.lastIndex;
    while (end < group.text.length && !URL_STOP.test(group.text[end])) end++;

    const candidateBoundaries = group.boundaries.filter(
      (boundary) => boundary.index > start && boundary.index < end,
    );
    for (const boundary of candidateBoundaries) {
      if (
        boundary.kind === "hard" &&
        !shouldCrossHardBoundary(
          group.text.slice(start, boundary.index),
          group.text.slice(boundary.index, end),
        )
      ) {
        end = boundary.index;
        break;
      }
    }

    const rawText = group.text.slice(start, end);
    const text = rawText.replace(URL_TRAILING_PUNCTUATION, "");
    end -= rawText.length - text.length;
    if (!text || !parseHttpUrl(text)) continue;

    const first = group.mapping[start];
    const last = group.mapping[end - 1];
    if (!first || !last) continue;
    result.push({
      text,
      range: {
        start: { x: first.startX, y: first.row + 1 },
        end: { x: last.endX, y: last.row + 1 },
      },
      requiresConfirmation: group.boundaries.some(
        (boundary) =>
          boundary.kind === "hard" && boundary.index > start && boundary.index < end,
      ),
    });
    URL_START.lastIndex = Math.max(URL_START.lastIndex, end);
  }
  return result;
}

/**
 * Compute terminal links from fresh buffer-like rows. The requested row is an
 * absolute zero-based buffer index; only links intersecting it are returned.
 */
export function computeTerminalLinks(
  rows: readonly TerminalLinkRowSnapshot[],
  requestedRow: number,
): TerminalLinkCandidate[] {
  const seen = new Set<string>();
  return assembleGroups(rows)
    .flatMap(linksInGroup)
    .filter(
      (link) =>
        link.range.start.y <= requestedRow + 1 &&
        link.range.end.y >= requestedRow + 1,
    )
    .filter((link) => {
      const key = `${link.range.start.x}:${link.range.start.y}-${link.range.end.x}:${link.range.end.y}:${link.text}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

interface TerminalLinkBufferCell {
  getChars(): string;
  getWidth(): number;
}

interface TerminalLinkBufferLine {
  readonly isWrapped: boolean;
  readonly length: number;
  getCell(column: number): TerminalLinkBufferCell | undefined;
}

interface TerminalLinkSource {
  readonly cols: number;
  readonly buffer: {
    readonly active: {
      readonly length: number;
      getLine(row: number): TerminalLinkBufferLine | undefined;
    };
  };
}

export interface TerminalLinkProviderOptions {
  /** Synchronous confirmation shown only for inferred hard-row links. */
  readonly confirm?: (target: string) => boolean;
  /** Protocol-restricted opener, normally createHttpLinkOpener(). */
  readonly open?: (target: string) => unknown;
  /** Number of rows examined above and below the requested row. */
  readonly scanRadius?: number;
}

function defaultHardLinkConfirmation(target: string): boolean {
  return window.confirm(
    `Open this inferred multi-line terminal link?\n\n${target}`,
  );
}

function snapshotBufferRow(
  source: TerminalLinkSource,
  index: number,
): TerminalLinkRowSnapshot | null {
  const line = source.buffer.active.getLine(index);
  if (!line) return null;
  const cells: TerminalLinkCellSnapshot[] = [];
  for (let column = 0; column < source.cols; column++) {
    const cell = column < line.length ? line.getCell(column) : undefined;
    cells.push({
      chars: cell?.getChars() ?? "",
      width: cell?.getWidth() ?? 1,
    });
  }
  return { index, isWrapped: line.isWrapped, cells };
}

/**
 * Build an xterm provider that snapshots the current active buffer on every
 * request, avoiding stale ranges after TUI repaints and terminal resizes.
 */
export function createTerminalLinkProvider(
  source: TerminalLinkSource,
  options: TerminalLinkProviderOptions = {},
): ILinkProvider {
  const confirm = options.confirm ?? defaultHardLinkConfirmation;
  const open = options.open ?? createHttpLinkOpener();
  const scanRadius = Math.max(1, options.scanRadius ?? 8);

  return {
    provideLinks(bufferLineNumber, callback) {
      const requestedRow = bufferLineNumber - 1;
      const start = Math.max(0, requestedRow - scanRadius);
      const end = Math.min(
        source.buffer.active.length - 1,
        requestedRow + scanRadius,
      );
      const rows: TerminalLinkRowSnapshot[] = [];
      for (let index = start; index <= end; index++) {
        const row = snapshotBufferRow(source, index);
        if (row) rows.push(row);
      }

      const links = computeTerminalLinks(rows, requestedRow).map((candidate) => ({
        text: candidate.text,
        range: candidate.range,
        activate: () => {
          if (candidate.requiresConfirmation && !confirm(candidate.text)) return;
          open(candidate.text);
        },
      }));
      callback(links.length > 0 ? links : undefined);
    },
  };
}
