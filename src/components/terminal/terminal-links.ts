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
  rawSegments: TerminalLinkCandidate["range"][];
  rawTermination: "separator" | "group-end";
  requiresConfirmation: boolean;
}

interface LexicalTerminalLinkCandidate {
  rawText: string;
  rawSegments: TerminalLinkCandidate["range"][];
  rawTermination: "separator" | "group-end";
  start: number;
}

interface ProviderTerminalLinkCandidate extends TerminalLinkCandidate {
  readonly guard: boolean;
}

const BORDER_CHARS = new Set(["│", "┃", "║", "|"]);
const URL_START = /https?:\/\//gi;
const URL_STOP = /[\s"'{}|\\^<>`]/u;
const TRAILING_SENTENCE_PUNCTUATION = new Set([".", ","]);
const FRESH_HTTP_SCHEME = /^https?:\/\//iu;
const HARD_BOUNDARY_STARTS = [
  /^(?:[-*#$%+>]\s|(?:\d+|[a-z])[.)]\s|[\w.-]+@[\w.-]+:\S*[$#%]\s|[•◦‣⁃∙·▪▫●○◆◇▶▸])/iu,
  /^PS [a-z]:\\[^>\r\n]*>\s/iu,
  /^\[[\w.-]+@[\w.-]+(?:\s+[^\]\r\n]+)?\][#$%]\s/iu,
  /^\([.\w-]+\)\s+(?:(?:[\w.-]+@[\w.-]+:\S*)?[$#%])\s/iu,
];

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

function isHardBoundaryStart(text: string): boolean {
  return HARD_BOUNDARY_STARTS.some((pattern) => pattern.test(text));
}

function hasUrlValueAssignmentSuffix(
  text: string,
  requireScheme: boolean,
): boolean {
  if (!text.endsWith("=")) return false;
  const schemeIndex = text.search(/https?:\/\//iu);
  if (requireScheme && schemeIndex < 0) return false;
  const token = schemeIndex >= 0 ? text.slice(schemeIndex) : text;
  // An ampersand has query semantics only after the URL has entered a query
  // or fragment. When the scheme is outside the inspected snapshot we cannot
  // know that state, so the partial context remains conservatively eligible.
  if (schemeIndex >= 0 && !token.includes("?") && !token.includes("#")) {
    return false;
  }
  const delimiterIndex = Math.max(
    token.lastIndexOf("?"),
    token.lastIndexOf("&"),
    token.lastIndexOf("#"),
  );
  const key = token.slice(delimiterIndex + 1, -1);
  return delimiterIndex >= 0 && key.length > 0 && !key.includes("=");
}

function expectsUrlValue(text: string): boolean {
  return hasUrlValueAssignmentSuffix(text, true);
}

function connectionBetween(
  previous: TerminalLinkRowSnapshot,
  next: TerminalLinkRowSnapshot,
  previousContext?: string,
  allowPartialUrlContext = false,
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
  const nextText = cellsText(next, nextBounds.start, nextBounds.end);
  if (isHardBoundaryStart(nextText)) {
    return null;
  }
  if (
    FRESH_HTTP_SCHEME.test(nextText) &&
    !expectsUrlValue(
      previousContext ??
        cellsText(previous, previousBounds.start, previousBounds.end),
    ) &&
    !(
      allowPartialUrlContext &&
      hasUrlValueAssignmentSuffix(
        cellsText(previous, previousBounds.start, previousBounds.end),
        false,
      )
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

function connectionsForRows(
  rows: readonly TerminalLinkRowSnapshot[],
): Array<RowConnection | null> {
  const connections: Array<RowConnection | null> = [];
  let context = "";
  for (let index = 0; index < rows.length - 1; index++) {
    const previous = rows[index];
    const bounds = contentBounds(previous);
    const incoming = connections[index - 1];
    if (!incoming) context = "";
    context += cellsText(
      previous,
      incoming?.nextStart ?? bounds.start,
      bounds.end,
    );
    connections.push(
      connectionBetween(previous, rows[index + 1], context),
    );
  }
  return connections;
}

function assembleGroups(rows: readonly TerminalLinkRowSnapshot[]): AssembledGroup[] {
  if (rows.length === 0) return [];
  const sortedRows = [...rows].sort((a, b) => a.index - b.index);
  const connections = connectionsForRows(sortedRows);
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
  const closingBalance: Record<string, number> = {
    ")": 0,
    "]": 0,
    "}": 0,
  };
  for (let index = 0; index < token.length; index++) {
    switch (token[index]) {
      case "(":
        closingBalance[")"]++;
        break;
      case ")":
        closingBalance[")"]--;
        break;
      case "[":
        closingBalance["]"]++;
        break;
      case "]":
        closingBalance["]"]--;
        break;
      case "{":
        closingBalance["}"]++;
        break;
      case "}":
        closingBalance["}"]--;
        break;
    }
  }

  let end = token.length;
  while (end > 0) {
    const last = token[end - 1];
    if (TRAILING_SENTENCE_PUNCTUATION.has(last)) {
      end--;
      continue;
    }
    if (closingBalance[last] < 0) {
      closingBalance[last]++;
      end--;
      continue;
    }
    break;
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

function lexicalLinksInGroup(
  group: AssembledGroup,
): LexicalTerminalLinkCandidate[] {
  const result: LexicalTerminalLinkCandidate[] = [];
  URL_START.lastIndex = 0;
  let startMatch: RegExpExecArray | null;
  while ((startMatch = URL_START.exec(group.text))) {
    const start = startMatch.index;
    let rawEnd = URL_START.lastIndex;
    while (rawEnd < group.text.length && !URL_STOP.test(group.text[rawEnd])) {
      rawEnd++;
    }

    const rawText = group.text.slice(start, rawEnd);
    const rawSegments = segmentsForMapping(group.mapping, start, rawEnd);
    if (rawSegments.length > 0) {
      result.push({
        rawText,
        rawSegments,
        rawTermination:
          rawEnd === group.text.length ? "group-end" : "separator",
        start,
      });
    }
    // Preserve the previous scanner behavior: a valid outer URL owns nested
    // schemes in its value, while an invalid outer token still lets a later
    // scheme be considered independently.
    if (parseHttpUrl(trimUrlToken(rawText))) {
      URL_START.lastIndex = Math.max(URL_START.lastIndex, rawEnd);
    }
  }
  return result;
}

function linksInGroup(group: AssembledGroup): FullTerminalLinkCandidate[] {
  const result: FullTerminalLinkCandidate[] = [];
  for (const lexical of lexicalLinksInGroup(group)) {
    const text = trimUrlToken(lexical.rawText);
    const end = lexical.start + text.length;
    if (!text || !parseHttpUrl(text)) continue;

    const segments = segmentsForMapping(group.mapping, lexical.start, end);
    if (segments.length === 0) continue;
    result.push({
      text,
      segments,
      rawSegments: lexical.rawSegments,
      rawTermination: lexical.rawTermination,
      requiresConfirmation: group.boundaries.some(
        (boundary) =>
          boundary.kind === "hard" &&
          boundary.index > lexical.start &&
          boundary.index < end,
      ),
    });
  }
  return result;
}

interface RequestedLinkSegment {
  link: FullTerminalLinkCandidate;
  range: TerminalLinkCandidate["range"];
}

function requestedLinkSegments(
  rows: readonly TerminalLinkRowSnapshot[],
  requestedRow: number,
): RequestedLinkSegment[] {
  const seen = new Set<string>();
  return assembleGroups(rows)
    .flatMap(linksInGroup)
    .flatMap((link) =>
      link.segments
        .filter((range) => range.start.y === requestedRow + 1)
        .map((range) => ({ link, range })),
    )
    .filter(({ link, range }) => {
      const key = `${range.start.x}:${range.start.y}-${range.end.x}:${range.end.y}:${link.text}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

/**
 * Compute terminal links from fresh buffer-like rows. The requested row is an
 * absolute zero-based buffer index; only links intersecting it are returned.
 */
export function computeTerminalLinks(
  rows: readonly TerminalLinkRowSnapshot[],
  requestedRow: number,
): TerminalLinkCandidate[] {
  return requestedLinkSegments(rows, requestedRow).map(({ link, range }) => ({
    text: link.text,
    range,
    requiresConfirmation: link.requiresConfirmation,
  }));
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
  /** Maximum UTF-16 code units assembled for one provider request. */
  readonly codeUnitBudget?: number;
}

const DEFAULT_LINK_SCAN_CELL_BUDGET = 16_384;
const DEFAULT_LINK_SCAN_CODE_UNIT_BUDGET = 32_768;

function defaultHardLinkConfirmation(target: string): boolean {
  return window.confirm(
    `Open this inferred multi-line terminal link?\n\n${target}`,
  );
}

interface BufferRowSnapshot {
  row: TerminalLinkRowSnapshot;
  inspectedCells: number;
  inspectedCodeUnits: number;
  resolvedEndColumn: number;
  clipped: boolean;
}

function snapshotBufferRow(
  buffer: TerminalLinkBuffer,
  cols: number,
  index: number,
  cellBudget: number,
  codeUnitBudget: number,
): BufferRowSnapshot | null {
  const line = buffer.getLine(index);
  if (!line) return null;
  const cells: TerminalLinkCellSnapshot[] = [];
  let inspectedCells = 0;
  let inspectedCodeUnits = 0;
  let resolvedEndColumn = 0;
  for (let column = 0; column < cols; column++) {
    if (inspectedCells >= cellBudget) break;
    const cell = column < line.length ? line.getCell(column) : undefined;
    inspectedCells++;
    const chars = cell?.getChars() ?? "";
    const width = cell?.getWidth() ?? 1;
    const codeUnits = width === 0 ? 0 : Math.max(1, chars.length);
    if (inspectedCodeUnits + codeUnits > codeUnitBudget) {
      break;
    }
    inspectedCodeUnits += codeUnits;
    cells.push({
      chars,
      width,
    });
    resolvedEndColumn = Math.min(
      cols,
      Math.max(resolvedEndColumn, column + Math.max(1, width)),
    );
  }
  return {
    row: { index, isWrapped: line.isWrapped, cells },
    inspectedCells,
    inspectedCodeUnits,
    resolvedEndColumn,
    clipped: cells.length < cols,
  };
}

interface StructuralSnapshot {
  rows: TerminalLinkRowSnapshot[];
  clippedBefore: boolean;
  clippedAfter: boolean;
  requestedResolvedEnd: number | null;
}

function couldContinueBefore(row: TerminalLinkRowSnapshot): boolean {
  if (row.index === 0) return false;
  if (row.isWrapped) return true;
  const bounds = contentBounds(row);
  if (firstContentColumn(row, bounds.start) !== bounds.start) return false;
  const text = cellsText(row, bounds.start, bounds.end);
  // A fresh scheme is usually a boundary, but it can also be the value of a
  // query parameter on the uninspected previous row. Resolve that context or
  // conservatively guard it instead of exposing the nested URL as exact.
  return !isHardBoundaryStart(text);
}

function couldContinueAfter(row: TerminalLinkRowSnapshot): boolean {
  const bounds = contentBounds(row);
  const contentEnd = lastContentEnd(row, bounds.end);
  return (
    contentEnd === bounds.end ||
    (contentEnd === bounds.end - 1 && isBlankCell(row.cells[bounds.end - 1]))
  );
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
  codeUnitBudget: number,
): StructuralSnapshot {
  const buffer = source.buffer.active;
  const cols = source.cols;
  if (
    requestedRow < 0 ||
    requestedRow >= buffer.length ||
    cols <= 0
  ) {
    return {
      rows: [],
      clippedBefore: false,
      clippedAfter: false,
      requestedResolvedEnd: null,
    };
  }

  const initial = snapshotBufferRow(
    buffer,
    cols,
    requestedRow,
    cellBudget,
    codeUnitBudget,
  );
  if (!initial) {
    return {
      rows: [],
      clippedBefore: false,
      clippedAfter: false,
      requestedResolvedEnd: null,
    };
  }
  if (initial.clipped) {
    return {
      rows: [initial.row],
      clippedBefore:
        requestedRow > 0 && couldContinueBefore(initial.row),
      clippedAfter: true,
      requestedResolvedEnd: initial.resolvedEndColumn,
    };
  }

  const rows = new Map<number, TerminalLinkRowSnapshot>([
    [requestedRow, initial.row],
  ]);
  let inspectedCells = initial.inspectedCells;
  let inspectedCodeUnits = initial.inspectedCodeUnits;
  let top = requestedRow;
  let bottom = requestedRow;
  let topOpen = top > 0;
  let bottomOpen = bottom < buffer.length - 1;
  let clippedBefore = false;
  let clippedAfter = false;
  let expandTopNext = true;
  const initialBounds = contentBounds(initial.row);
  let connectionContext = cellsText(
    initial.row,
    initialBounds.start,
    initialBounds.end,
  );

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
      if (couldContinue) {
        if (expandTop) clippedBefore = true;
        else clippedAfter = true;
      }
      if (expandTop) topOpen = false;
      else bottomOpen = false;
      continue;
    }

    const adjacentSnapshot = snapshotBufferRow(
      buffer,
      cols,
      adjacentIndex,
      cols,
      codeUnitBudget - inspectedCodeUnits,
    );
    inspectedCells += adjacentSnapshot?.inspectedCells ?? 0;
    inspectedCodeUnits += adjacentSnapshot?.inspectedCodeUnits ?? 0;
    if (adjacentSnapshot?.clipped) {
      const couldContinue = expandTop
        ? couldContinueBefore(edge)
        : couldContinueAfter(edge);
      if (couldContinue) {
        if (expandTop) clippedBefore = true;
        else clippedAfter = true;
      }
      if (expandTop) topOpen = false;
      else bottomOpen = false;
      continue;
    }
    const adjacent = adjacentSnapshot?.row;
    const connection = adjacent
      ? expandTop
        ? connectionBetween(adjacent, edge, undefined, true)
        : connectionBetween(edge, adjacent, connectionContext)
      : null;
    if (!adjacent || !connection) {
      if (expandTop) topOpen = false;
      else bottomOpen = false;
      continue;
    }

    rows.set(adjacentIndex, adjacent);
    if (expandTop) {
      const adjacentBounds = contentBounds(adjacent);
      connectionContext =
        cellsText(
          adjacent,
          adjacentBounds.start,
          connection.previousEnd,
        ) + connectionContext;
      top = adjacentIndex;
      topOpen = top > 0;
    } else {
      const adjacentBounds = contentBounds(adjacent);
      connectionContext += cellsText(
        adjacent,
        connection.nextStart,
        adjacentBounds.end,
      );
      bottom = adjacentIndex;
      bottomOpen = bottom < buffer.length - 1;
    }
  }

  return {
    rows: [...rows.values()].sort((a, b) => a.index - b.index),
    clippedBefore,
    clippedAfter,
    requestedResolvedEnd: null,
  };
}

function lexicalLinkTouchesClippedEdge(
  link: Pick<
    LexicalTerminalLinkCandidate,
    "rawSegments" | "rawTermination"
  >,
  snapshot: StructuralSnapshot,
): boolean {
  const top = snapshot.rows[0];
  const bottom = snapshot.rows[snapshot.rows.length - 1];
  if (snapshot.clippedBefore && top && link.rawSegments[0]) {
    const firstRange = link.rawSegments[0];
    const startRowPosition = snapshot.rows.findIndex(
      (row) => row.index + 1 === firstRange.start.y,
    );
    const startRow = snapshot.rows[startRowPosition];
    if (startRow) {
      const bounds = contentBounds(startRow);
      const startsAtContentEdge =
        firstRange.start.x === firstContentColumn(startRow, bounds.start) + 1;
      if (startsAtContentEdge && startRow.index === top.index) return true;

      const previous = snapshot.rows[startRowPosition - 1];
      if (startsAtContentEdge && previous) {
        const previousBounds = contentBounds(previous);
        if (
          hasUrlValueAssignmentSuffix(
            cellsText(previous, previousBounds.start, previousBounds.end),
            false,
          )
        ) {
          return true;
        }
      }
    }
  }
  if (snapshot.clippedAfter && bottom) {
    const bounds = contentBounds(bottom);
    const contentEnd = lastContentEnd(bottom, bounds.end);
    const possibleEarlyWideWrap =
      snapshot.requestedResolvedEnd === null &&
      contentEnd === bounds.end - 1 &&
      isBlankCell(bottom.cells[bounds.end - 1]);
    if (
      (link.rawTermination === "group-end" || possibleEarlyWideWrap) &&
      link.rawSegments.some(
        (range) => range.end.y === bottom.index + 1 && range.end.x === contentEnd,
      )
    ) {
      return true;
    }
  }
  return false;
}

function linkTouchesClippedEdge(
  link: FullTerminalLinkCandidate,
  snapshot: StructuralSnapshot,
): boolean {
  return lexicalLinkTouchesClippedEdge(link, snapshot);
}

function computeCurrentTerminalLinks(
  source: TerminalLinkSource,
  requestedRow: number,
  cellBudget: number,
  codeUnitBudget: number,
): ProviderTerminalLinkCandidate[] {
  const snapshot = collectStructuralSnapshot(
    source,
    requestedRow,
    cellBudget,
    codeUnitBudget,
  );
  if (snapshot.clippedBefore || snapshot.clippedAfter) {
    const requested = snapshot.rows.find((row) => row.index === requestedRow);
    const localCandidates = requested
      ? computeTerminalLinks([requested], requestedRow)
      : [];
    const candidates = requestedLinkSegments(snapshot.rows, requestedRow).map(
      ({ link, range }) => {
        const guard = linkTouchesClippedEdge(link, snapshot);
        const rawRange = link.rawSegments.find(
          (candidateRange) => candidateRange.start.y === requestedRow + 1,
        );
        const localText = localCandidates.find(
          (candidate) =>
            candidate.range.start.x === range.start.x &&
            candidate.range.end.x === range.end.x,
        )?.text;
        let candidateRange = guard && rawRange ? rawRange : range;
        if (
          guard &&
          rawRange &&
          snapshot.requestedResolvedEnd !== null &&
          rawRange.end.x === snapshot.requestedResolvedEnd
        ) {
          candidateRange = {
            start: rawRange.start,
            end: { x: source.cols, y: requestedRow + 1 },
          };
        }
        return {
          text: guard ? (localText ?? link.text) : link.text,
          range: candidateRange,
          requiresConfirmation: link.requiresConfirmation,
          guard,
        };
      },
    );
    for (const group of assembleGroups(snapshot.rows)) {
      for (const lexical of lexicalLinksInGroup(group)) {
        if (parseHttpUrl(trimUrlToken(lexical.rawText))) continue;
        if (!lexicalLinkTouchesClippedEdge(lexical, snapshot)) continue;
        for (const rawRange of lexical.rawSegments) {
          if (rawRange.start.y !== requestedRow + 1) continue;
          const reachesRequestedClip =
            snapshot.requestedResolvedEnd !== null &&
            rawRange.end.x >= snapshot.requestedResolvedEnd;
          candidates.push({
            text: lexical.rawText,
            range: reachesRequestedClip
              ? {
                  start: rawRange.start,
                  end: { x: source.cols, y: requestedRow + 1 },
                }
              : rawRange,
            requiresConfirmation: false,
            guard: true,
          });
        }
      }
    }
    if (snapshot.requestedResolvedEnd !== null) {
      const firstUnresolvedX = snapshot.requestedResolvedEnd + 1;
      const unresolvedCovered = candidates.some(
        (candidate) =>
          candidate.guard &&
          candidate.range.start.x <= firstUnresolvedX &&
          candidate.range.end.x >= source.cols,
      );
      if (firstUnresolvedX <= source.cols && !unresolvedCovered) {
        candidates.push({
          text: "",
          range: {
            start: { x: firstUnresolvedX, y: requestedRow + 1 },
            end: { x: source.cols, y: requestedRow + 1 },
          },
          requiresConfirmation: false,
          guard: true,
        });
      }
    }
    return candidates;
  }
  return computeTerminalLinks(snapshot.rows, requestedRow).map((candidate) => ({
    ...candidate,
    guard: false,
  }));
}

function linkIdentity(link: ProviderTerminalLinkCandidate): string {
  return [
    link.text,
    link.requiresConfirmation ? "inferred" : "exact",
    link.guard ? "guard" : "navigable",
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
  const requestedCellBudget = options.cellBudget ?? DEFAULT_LINK_SCAN_CELL_BUDGET;
  const cellBudget = Number.isFinite(requestedCellBudget)
    ? Math.max(1, Math.floor(requestedCellBudget))
    : DEFAULT_LINK_SCAN_CELL_BUDGET;
  const requestedCodeUnitBudget =
    options.codeUnitBudget ?? DEFAULT_LINK_SCAN_CODE_UNIT_BUDGET;
  const codeUnitBudget = Number.isFinite(requestedCodeUnitBudget)
    ? Math.max(1, Math.floor(requestedCodeUnitBudget))
    : DEFAULT_LINK_SCAN_CODE_UNIT_BUDGET;

  return {
    provideLinks(bufferLineNumber, callback) {
      const requestedRow = bufferLineNumber - 1;
      const candidates = computeCurrentTerminalLinks(
        source,
        requestedRow,
        cellBudget,
        codeUnitBudget,
      );
      const links = candidates.map((candidate) => {
        if (candidate.guard) {
          return {
            text: candidate.text,
            range: candidate.range,
            decorations: { pointerCursor: false, underline: false },
            activate: () => {},
          };
        }
        const identity = linkIdentity(candidate);
        return {
          text: candidate.text,
          range: candidate.range,
          activate: () => {
            const current = computeCurrentTerminalLinks(
              source,
              requestedRow,
              cellBudget,
              codeUnitBudget,
            ).find((link) => linkIdentity(link) === identity);
            if (!current || current.guard) return;
            if (current.requiresConfirmation && !confirm(current.text)) return;
            open(current.text);
          },
        };
      });
      callback(links.length > 0 ? links : undefined);
    },
  };
}
