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
  exteriorPrefix: string;
  exteriorSuffix: string;
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

interface FullTerminalLinkCandidate {
  text: string;
  segments: TerminalLinkCandidate["range"][];
  requiresConfirmation: boolean;
}

const BORDER_CHARS = new Set(["│", "┃", "║", "|"]);
const URL_START = /https?:\/\//gi;
const URL_STOP = /[\s"'{}|\\^<>`]/u;
const SENTENCE_PUNCTUATION = new Set([".", ",", "!", "?", ";", ":"]);
const HARD_CONTINUATION_START = /^(?:https?:\/\/|[-*#]\s|[•◦‣⁃∙·▪▫●○◆◇▶▸])/iu;

function isBlankCell(cell: TerminalLinkCellSnapshot | undefined): boolean {
  return !cell || cell.width === 0 || cell.chars === "" || /^\s+$/u.test(cell.chars);
}

function cellsSignature(
  row: TerminalLinkRowSnapshot,
  start: number,
  end: number,
): string {
  return row.cells
    .slice(start, end)
    .map((cell) => `${cell.width}:${cell.chars || " "}`)
    .join("\u0000");
}

function cellsText(
  row: TerminalLinkRowSnapshot,
  start: number,
  end: number,
): string {
  let result = "";
  for (let column = start; column < Math.min(end, row.cells.length); column++) {
    const cell = row.cells[column];
    if (!cell || cell.width === 0) continue;
    result += cell.chars || " ";
  }
  return result;
}

function contentBounds(row: TerminalLinkRowSnapshot): ContentBounds {
  let first = 0;
  while (first < row.cells.length && isBlankCell(row.cells[first])) first++;

  let last = row.cells.length - 1;
  while (last >= first && isBlankCell(row.cells[last])) last--;

  const bounds: ContentBounds = {
    start: first,
    end: row.cells.length,
    exteriorPrefix: "",
    exteriorSuffix: "",
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

  bounds.exteriorPrefix = cellsSignature(row, 0, bounds.start);
  bounds.exteriorSuffix = bounds.rightBorder
    ? cellsSignature(row, bounds.end, row.cells.length)
    : "";

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
  return (
    previous.start === next.start &&
    previous.end === next.end &&
    previous.exteriorPrefix === next.exteriorPrefix &&
    previous.exteriorSuffix === next.exteriorSuffix
  );
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
  if (
    HARD_CONTINUATION_START.test(
      cellsText(next, nextBounds.start, nextBounds.end),
    )
  ) {
    return null;
  }
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

function trimUrlToken(token: string): string {
  let end = token.length;
  let changed = true;
  while (changed && end > 0) {
    changed = false;
    while (end > 0 && SENTENCE_PUNCTUATION.has(token[end - 1])) {
      end--;
      changed = true;
    }

    const last = token[end - 1];
    const pairs: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
    const open = pairs[last];
    if (open) {
      const value = token.slice(0, end);
      const opens = Array.from(value).filter((char) => char === open).length;
      const closes = Array.from(value).filter((char) => char === last).length;
      if (closes > opens) {
        end--;
        changed = true;
      }
    }
  }
  return token.slice(0, end);
}

function segmentsForMapping(
  mapping: readonly MappedCodeUnit[],
  start: number,
  end: number,
): TerminalLinkCandidate["range"][] {
  const result: TerminalLinkCandidate["range"][] = [];
  let first = mapping[start];
  let last = first;
  for (let index = start + 1; index < end; index++) {
    const current = mapping[index];
    if (!current) continue;
    if (!first || !last || current.row !== last.row) {
      if (first && last) {
        result.push({
          start: { x: first.startX, y: first.row + 1 },
          end: { x: last.endX, y: last.row + 1 },
        });
      }
      first = current;
    }
    last = current;
  }
  if (first && last) {
    result.push({
      start: { x: first.startX, y: first.row + 1 },
      end: { x: last.endX, y: last.row + 1 },
    });
  }
  return result;
}

function linksInGroup(group: AssembledGroup): FullTerminalLinkCandidate[] {
  const result: FullTerminalLinkCandidate[] = [];
  URL_START.lastIndex = 0;
  let startMatch: RegExpExecArray | null;
  while ((startMatch = URL_START.exec(group.text))) {
    const start = startMatch.index;
    let end = URL_START.lastIndex;
    while (end < group.text.length && !URL_STOP.test(group.text[end])) end++;

    const rawText = group.text.slice(start, end);
    const text = trimUrlToken(rawText);
    end -= rawText.length - text.length;
    if (!text || !parseHttpUrl(text)) continue;

    const segments = segmentsForMapping(group.mapping, start, end);
    if (segments.length === 0) continue;
    result.push({
      text,
      segments,
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
    .flatMap((link) =>
      link.segments
        .filter((range) => range.start.y === requestedRow + 1)
        .map((range) => ({
          text: link.text,
          range,
          requiresConfirmation: link.requiresConfirmation,
        })),
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

interface TerminalLinkBuffer {
  readonly length: number;
  getLine(row: number): TerminalLinkBufferLine | undefined;
}

interface TerminalLinkSource {
  readonly cols: number;
  readonly buffer: {
    readonly active: TerminalLinkBuffer;
  };
}

export interface TerminalLinkProviderOptions {
  /** Synchronous confirmation shown only for inferred hard-row links. */
  readonly confirm?: (target: string) => boolean;
  /** Protocol-restricted opener, normally createHttpLinkOpener(). */
  readonly open?: (target: string) => unknown;
  /** Maximum number of terminal cells inspected for one provider request. */
  readonly cellBudget?: number;
}

const DEFAULT_LINK_SCAN_CELL_BUDGET = 16_384;

function defaultHardLinkConfirmation(target: string): boolean {
  return window.confirm(
    `Open this inferred multi-line terminal link?\n\n${target}`,
  );
}

function snapshotBufferRow(
  buffer: TerminalLinkBuffer,
  cols: number,
  index: number,
): TerminalLinkRowSnapshot | null {
  const line = buffer.getLine(index);
  if (!line) return null;
  const cells: TerminalLinkCellSnapshot[] = [];
  for (let column = 0; column < cols; column++) {
    const cell = column < line.length ? line.getCell(column) : undefined;
    cells.push({
      chars: cell?.getChars() ?? "",
      width: cell?.getWidth() ?? 1,
    });
  }
  return { index, isWrapped: line.isWrapped, cells };
}

interface StructuralSnapshot {
  rows: TerminalLinkRowSnapshot[];
  clipped: boolean;
}

function couldContinueBefore(row: TerminalLinkRowSnapshot): boolean {
  if (row.index === 0) return false;
  if (row.isWrapped) return true;
  const bounds = contentBounds(row);
  if (firstContentColumn(row, bounds.start) !== bounds.start) return false;
  return !HARD_CONTINUATION_START.test(
    cellsText(row, bounds.start, bounds.end),
  );
}

function couldContinueAfter(row: TerminalLinkRowSnapshot): boolean {
  const bounds = contentBounds(row);
  return lastContentEnd(row, bounds.end) === bounds.end;
}

/**
 * Expand only through structurally connected rows, alternating upward and
 * downward from the requested row. Cost is bounded by inspected terminal
 * cells rather than a fixed row count. If the budget cannot resolve a
 * potentially connected edge, the snapshot is clipped and must not yield a
 * navigable candidate.
 */
function collectStructuralSnapshot(
  source: TerminalLinkSource,
  requestedRow: number,
  cellBudget: number,
): StructuralSnapshot {
  const buffer = source.buffer.active;
  const cols = source.cols;
  if (
    requestedRow < 0 ||
    requestedRow >= buffer.length ||
    cols <= 0 ||
    cellBudget < cols
  ) {
    return { rows: [], clipped: false };
  }

  const initial = snapshotBufferRow(buffer, cols, requestedRow);
  if (!initial) return { rows: [], clipped: false };

  const rows = new Map<number, TerminalLinkRowSnapshot>([
    [requestedRow, initial],
  ]);
  let inspectedCells = cols;
  let top = requestedRow;
  let bottom = requestedRow;
  let topOpen = top > 0;
  let bottomOpen = bottom < buffer.length - 1;
  let clipped = false;
  let expandTopNext = true;

  while (topOpen || bottomOpen) {
    const expandTop = topOpen && (!bottomOpen || expandTopNext);
    expandTopNext = !expandTopNext;
    const edgeIndex = expandTop ? top : bottom;
    const edge = rows.get(edgeIndex)!;
    const adjacentIndex = expandTop ? edgeIndex - 1 : edgeIndex + 1;

    if (inspectedCells + cols > cellBudget) {
      const couldContinue = expandTop
        ? couldContinueBefore(edge)
        : couldContinueAfter(edge);
      if (couldContinue) clipped = true;
      if (expandTop) topOpen = false;
      else bottomOpen = false;
      continue;
    }

    const adjacent = snapshotBufferRow(buffer, cols, adjacentIndex);
    inspectedCells += cols;
    const connection = adjacent
      ? expandTop
        ? connectionBetween(adjacent, edge)
        : connectionBetween(edge, adjacent)
      : null;
    if (!adjacent || !connection) {
      if (expandTop) topOpen = false;
      else bottomOpen = false;
      continue;
    }

    rows.set(adjacentIndex, adjacent);
    if (expandTop) {
      top = adjacentIndex;
      topOpen = top > 0;
    } else {
      bottom = adjacentIndex;
      bottomOpen = bottom < buffer.length - 1;
    }
  }

  return {
    rows: [...rows.values()].sort((a, b) => a.index - b.index),
    clipped,
  };
}

function computeCurrentTerminalLinks(
  source: TerminalLinkSource,
  requestedRow: number,
  cellBudget: number,
): TerminalLinkCandidate[] {
  const snapshot = collectStructuralSnapshot(source, requestedRow, cellBudget);
  if (snapshot.clipped) return [];
  return computeTerminalLinks(snapshot.rows, requestedRow);
}

function linkIdentity(link: TerminalLinkCandidate): string {
  return [
    link.text,
    link.requiresConfirmation ? "inferred" : "exact",
    link.range.start.x,
    link.range.start.y,
    link.range.end.x,
    link.range.end.y,
  ].join("\u0000");
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
  const cellBudget = Math.max(
    1,
    options.cellBudget ?? DEFAULT_LINK_SCAN_CELL_BUDGET,
  );

  return {
    provideLinks(bufferLineNumber, callback) {
      const requestedRow = bufferLineNumber - 1;
      const candidates = computeCurrentTerminalLinks(
        source,
        requestedRow,
        cellBudget,
      );
      const links = candidates.map((candidate) => {
        const identity = linkIdentity(candidate);
        return {
          text: candidate.text,
          range: candidate.range,
          activate: () => {
            const current = computeCurrentTerminalLinks(
              source,
              requestedRow,
              cellBudget,
            ).find((link) => linkIdentity(link) === identity);
            if (!current) return;
            if (current.requiresConfirmation && !confirm(current.text)) return;
            open(current.text);
          },
        };
      });
      callback(links.length > 0 ? links : undefined);
    },
  };
}
