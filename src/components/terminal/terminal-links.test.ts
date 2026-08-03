import { describe, expect, it, vi } from "vitest";

import {
  computeTerminalLinks,
  createHttpLinkOpener,
  createTerminalLinkProvider,
  parseHttpUrl,
  type TerminalLinkCellSnapshot,
  type TerminalLinkRowSnapshot,
} from "./terminal-links";
import type { ILink, ILinkProvider } from "@xterm/xterm";

function cellsFromText(text: string, cols: number): TerminalLinkCellSnapshot[] {
  const cells = Array.from(text, (chars) => ({ chars, width: 1 }));
  while (cells.length < cols) cells.push({ chars: "", width: 1 });
  return cells.slice(0, cols);
}

function row(
  index: number,
  text: string,
  cols: number,
  isWrapped = false,
): TerminalLinkRowSnapshot {
  return { index, isWrapped, cells: cellsFromText(text, cols) };
}

function rowsForUrl(
  url: string,
  cols: number,
  isWrapped: (index: number) => boolean = () => false,
): TerminalLinkRowSnapshot[] {
  const result: TerminalLinkRowSnapshot[] = [];
  for (let offset = 0; offset < url.length; offset += cols) {
    const index = result.length;
    result.push(row(index, url.slice(offset, offset + cols), cols, isWrapped(index)));
  }
  return result;
}

function terminalBuffer(rows: TerminalLinkRowSnapshot[]) {
  return {
    cols: rows[0]?.cells.length ?? 0,
    buffer: {
      active: {
        get length() {
          return rows.length;
        },
        getLine(index: number) {
          const source = rows[index];
          if (!source) return undefined;
          return {
            isWrapped: source.isWrapped,
            length: source.cells.length,
            getCell(column: number) {
              const cell = source.cells[column];
              if (!cell) return undefined;
              return {
                getChars: () => cell.chars,
                getWidth: () => cell.width,
              };
            },
          };
        },
      },
    },
  };
}

function provide(provider: ILinkProvider, oneBasedRow: number): ILink[] {
  let result: ILink[] | undefined;
  provider.provideLinks(oneBasedRow, (links) => {
    result = links;
  });
  return result ?? [];
}

describe("terminal link security", () => {
  it("accepts only absolute HTTP and HTTPS URLs", () => {
    expect(parseHttpUrl("https://example.com/a?q=1")?.href).toBe(
      "https://example.com/a?q=1",
    );
    expect(parseHttpUrl("HTTP://EXAMPLE.COM/path")?.protocol).toBe("http:");

    expect(parseHttpUrl("javascript:alert(1)")).toBeNull();
    expect(parseHttpUrl("file:///etc/passwd")).toBeNull();
    expect(parseHttpUrl("//example.com/path")).toBeNull();
    expect(parseHttpUrl("not a URL")).toBeNull();
  });

  it("opens parsed links in an isolated new browsing context", () => {
    const openWindow = vi.fn(() => ({}) as Window);
    const open = createHttpLinkOpener(openWindow);

    expect(open("https://example.com/a b")).toBe(true);
    expect(openWindow).toHaveBeenCalledWith(
      "https://example.com/a%20b",
      "_blank",
      "noopener,noreferrer",
    );

    expect(open("data:text/html,bad")).toBe(false);
    expect(openWindow).toHaveBeenCalledTimes(1);
  });
});

describe("terminal link reconstruction", () => {
  it("reconstructs a plain URL across hard terminal edges from either row", () => {
    const url = "https://example.test/a-long/path?value=one";
    const rows = rowsForUrl(url, 21);

    const firstRowLinks = computeTerminalLinks(rows, 0);
    const secondRowLinks = computeTerminalLinks(rows, 1);

    expect(firstRowLinks).toHaveLength(1);
    expect(firstRowLinks[0]).toMatchObject({ text: url, requiresConfirmation: true });
    expect(secondRowLinks).toEqual(firstRowLinks);
    expect(firstRowLinks[0].range).toEqual({
      start: { x: 1, y: 1 },
      end: { x: 21, y: 2 },
    });
  });

  it("treats genuine xterm soft wraps as exact links that may open directly", () => {
    const url = "https://example.test/a-long/path";
    const rows = rowsForUrl(url, 20, (index) => index > 0);

    expect(computeTerminalLinks(rows, 1)).toEqual([
      {
        text: url,
        requiresConfirmation: false,
        range: {
          start: { x: 1, y: 1 },
          end: { x: 12, y: 2 },
        },
      },
    ]);
  });

  it("follows matching indentation on cursor-positioned rows", () => {
    const url = "https://example.test/indented/path";
    const cols = 24;
    const contentCols = cols - 2;
    const rows = rowsForUrl(url, contentCols).map((item) =>
      row(item.index, `  ${item.cells.map((cell) => cell.chars).join("")}`, cols),
    );

    expect(computeTerminalLinks(rows, 1)).toEqual([
      {
        text: url,
        requiresConfirmation: true,
        range: {
          start: { x: 3, y: 1 },
          end: { x: 14, y: 2 },
        },
      },
    ]);
  });

  it("uses stable bordered panel gutters as effective content edges", () => {
    const url = "https://example.test/panel/a-long-path";
    const cols = 26;
    const contentCols = cols - 4;
    const rows = rowsForUrl(url, contentCols).map((item) => {
      const content = item.cells.map((cell) => cell.chars || " ").join("");
      return row(item.index, `│ ${content} │`, cols);
    });

    const links = computeTerminalLinks(rows, 0);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ text: url, requiresConfirmation: true });
    expect(links[0].range).toEqual({
      start: { x: 3, y: 1 },
      end: { x: 18, y: 2 },
    });
  });

  it("skips stable labeled gutters repeated outside panel delimiters", () => {
    const url = "https://example.test/panel/a-long-path";
    const prefix = "12 │ ";
    const suffix = " │ 12";
    const contentCols = 22;
    const cols = prefix.length + contentCols + suffix.length;
    const rows = rowsForUrl(url, contentCols).map((item) => {
      const content = item.cells.map((cell) => cell.chars || " ").join("");
      return row(item.index, `${prefix}${content}${suffix}`, cols);
    });

    expect(computeTerminalLinks(rows, 1)).toEqual([
      {
        text: url,
        requiresConfirmation: true,
        range: {
          start: { x: 6, y: 1 },
          end: { x: 21, y: 2 },
        },
      },
    ]);
  });

  it("does not append an unrelated next-row word to a complete last-cell URL", () => {
    const url = "https://example.test/a";
    const cols = url.length;
    const rows = [row(0, url, cols), row(1, "unrelated status", cols)];

    expect(computeTerminalLinks(rows, 0)).toEqual([
      {
        text: url,
        requiresConfirmation: false,
        range: {
          start: { x: 1, y: 1 },
          end: { x: cols, y: 1 },
        },
      },
    ]);
    expect(computeTerminalLinks(rows, 1)).toEqual([]);
  });

  it("stops at spaces and trims sentence punctuation", () => {
    const cols = 60;
    const rows = [
      row(0, "See https://example.test/a). Then https://second.test/b,", cols),
    ];

    expect(computeTerminalLinks(rows, 0).map((link) => link.text)).toEqual([
      "https://example.test/a",
      "https://second.test/b",
    ]);
  });

  it("maps wide and combining cells back to xterm ranges", () => {
    const cells: TerminalLinkCellSnapshot[] = [
      { chars: "中", width: 2 },
      { chars: "", width: 0 },
      { chars: " ", width: 1 },
      ...cellsFromText("https://example.test/caf", 24),
    ];
    const first = { index: 0, isWrapped: false, cells };
    const secondCells = [
      { chars: "e\u0301", width: 1 },
      { chars: "n", width: 1 },
      { chars: "d", width: 1 },
      ...cellsFromText("", cells.length - 3),
    ];
    const second = { index: 1, isWrapped: true, cells: secondCells };

    expect(computeTerminalLinks([first, second], 1)).toEqual([
      {
        text: "https://example.test/cafe\u0301nd",
        requiresConfirmation: false,
        range: {
          start: { x: 4, y: 1 },
          end: { x: 3, y: 2 },
        },
      },
    ]);
  });

  it("skips xterm's phantom last cell before an early-wrapped wide glyph", () => {
    const firstCells = [
      ...cellsFromText("https://example.test/caf", 24),
      { chars: "", width: 1 },
    ];
    const secondCells: TerminalLinkCellSnapshot[] = [
      { chars: "中", width: 2 },
      { chars: "", width: 0 },
      { chars: "x", width: 1 },
      ...cellsFromText("", 22),
    ];

    expect(
      computeTerminalLinks(
        [
          { index: 0, isWrapped: false, cells: firstCells },
          { index: 1, isWrapped: true, cells: secondCells },
        ],
        1,
      ),
    ).toEqual([
      {
        text: "https://example.test/caf中x",
        requiresConfirmation: false,
        range: {
          start: { x: 1, y: 1 },
          end: { x: 3, y: 2 },
        },
      },
    ]);
  });

  it("returns multiple HTTP links and ignores unsafe protocols", () => {
    const cols = 90;
    const rows = [
      row(
        0,
        "javascript:alert(1) https://one.test/a file:///tmp/x http://two.test/b",
        cols,
      ),
    ];

    expect(computeTerminalLinks(rows, 0).map((link) => link.text)).toEqual([
      "https://one.test/a",
      "http://two.test/b",
    ]);
  });
});

describe("terminal link provider", () => {
  it("owns the complete hard-row range and confirms its full target synchronously", () => {
    const url = "https://example.test/a-long/path?value=one";
    const terminal = terminalBuffer(rowsForUrl(url, 21));
    const confirm = vi.fn(() => false);
    const open = vi.fn(() => true);
    const provider = createTerminalLinkProvider(terminal, { confirm, open });

    const firstRowLink = provide(provider, 1)[0];
    const secondRowLink = provide(provider, 2)[0];
    expect(firstRowLink.text).toBe(url);
    expect(secondRowLink).toMatchObject({ text: url, range: firstRowLink.range });

    firstRowLink.activate(new MouseEvent("click"), firstRowLink.text);
    expect(confirm).toHaveBeenCalledWith(url);
    expect(open).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    secondRowLink.activate(new MouseEvent("click"), secondRowLink.text);
    expect(open).toHaveBeenCalledWith(url);
  });

  it("opens natural soft wraps directly without confirmation", () => {
    const url = "https://example.test/a-long/path";
    const terminal = terminalBuffer(rowsForUrl(url, 20, (index) => index > 0));
    const confirm = vi.fn(() => false);
    const open = vi.fn(() => true);
    const provider = createTerminalLinkProvider(terminal, { confirm, open });

    const link = provide(provider, 2)[0];
    link.activate(new MouseEvent("click"), link.text);

    expect(confirm).not.toHaveBeenCalled();
    expect(open).toHaveBeenCalledWith(url);
  });

  it("recomputes from current cells and dimensions after repaint and resize", () => {
    const firstUrl = "https://first.test/a-long/path";
    const secondUrl = "https://second.test/a-much-longer/path";
    const rows = rowsForUrl(firstUrl, 18);
    const terminal = terminalBuffer(rows);
    const provider = createTerminalLinkProvider(terminal, {
      confirm: () => true,
      open: () => true,
    });

    expect(provide(provider, 1)[0].text).toBe(firstUrl);

    rows.splice(0, rows.length, ...rowsForUrl(secondUrl, 24));
    terminal.cols = 24;

    expect(provide(provider, 1)[0]).toMatchObject({
      text: secondUrl,
      range: {
        start: { x: 1, y: 1 },
        end: { x: 14, y: 2 },
      },
    });
  });
});
