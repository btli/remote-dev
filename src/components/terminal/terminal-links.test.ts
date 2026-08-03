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
  let activeRows = rows;
  const terminal = {
    cols: rows[0]?.cells.length ?? 0,
    buffer: {
      get active() {
        return {
          get length() {
            return activeRows.length;
          },
          getLine(index: number) {
            const source = activeRows[index];
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
        };
      },
    },
    setActiveRows(nextRows: TerminalLinkRowSnapshot[]) {
      activeRows = nextRows;
      terminal.cols = nextRows[0]?.cells.length ?? terminal.cols;
    },
  };
  return terminal;
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
  it.each([
    ["https://example.test/pathlong", "continuation"],
    ["https://example.test/?token=abc", "def"],
  ])(
    "never exposes a direct truncated fragment at an ambiguous alphanumeric hard boundary",
    (prefix, continuation) => {
      const cols = Math.max(prefix.length, continuation.length);
      const rows = [row(0, prefix, cols), row(1, continuation, cols)];
      const target = `${prefix}${continuation}`;
      const confirm = vi.fn(() => true);
      const open = vi.fn(() => true);
      const provider = createTerminalLinkProvider(terminalBuffer(rows), {
        confirm,
        open,
      });

      for (const requestedRow of [1, 2]) {
        const link = provide(provider, requestedRow)[0];
        expect(link).toMatchObject({
          text: target,
          range: {
            start: { y: requestedRow },
            end: { y: requestedRow },
          },
        });
        link.activate(new MouseEvent("click"), link.text);
      }

      expect(confirm).toHaveBeenCalledTimes(2);
      expect(confirm).toHaveBeenNthCalledWith(1, target);
      expect(confirm).toHaveBeenNthCalledWith(2, target);
      expect(open).toHaveBeenNthCalledWith(1, target);
      expect(open).toHaveBeenNthCalledWith(2, target);
    },
  );

  it("reconstructs a plain URL across hard terminal edges from either row", () => {
    const url = "https://example.test/a-long/path?value=one";
    const rows = rowsForUrl(url, 21);

    const firstRowLinks = computeTerminalLinks(rows, 0);
    const secondRowLinks = computeTerminalLinks(rows, 1);

    expect(firstRowLinks).toHaveLength(1);
    expect(firstRowLinks[0]).toMatchObject({ text: url, requiresConfirmation: true });
    expect(secondRowLinks[0]).toMatchObject({
      text: url,
      requiresConfirmation: true,
    });
    expect(firstRowLinks[0].range).toEqual({
      start: { x: 1, y: 1 },
      end: { x: 21, y: 1 },
    });
    expect(secondRowLinks[0].range).toEqual({
      start: { x: 1, y: 2 },
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
          start: { x: 1, y: 2 },
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
          start: { x: 3, y: 2 },
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
      end: { x: 24, y: 1 },
    });
  });

  it("returns only the visible URL cells as the hit range on each indented row", () => {
    const url = "https://example.test/indented/path";
    const cols = 24;
    const contentCols = cols - 2;
    const rows = rowsForUrl(url, contentCols).map((item) =>
      row(item.index, `  ${item.cells.map((cell) => cell.chars).join("")}`, cols),
    );
    const provider = createTerminalLinkProvider(terminalBuffer(rows), {
      confirm: () => true,
      open: () => true,
    });

    expect(provide(provider, 1)[0].range).toEqual({
      start: { x: 3, y: 1 },
      end: { x: 24, y: 1 },
    });
    expect(provide(provider, 2)[0].range).toEqual({
      start: { x: 3, y: 2 },
      end: { x: 14, y: 2 },
    });
  });

  it("excludes bordered panel gutters from every row-local hit range", () => {
    const url = "https://example.test/panel/a-long-path";
    const cols = 26;
    const contentCols = cols - 4;
    const rows = rowsForUrl(url, contentCols).map((item) => {
      const content = item.cells.map((cell) => cell.chars || " ").join("");
      return row(item.index, `│ ${content} │`, cols);
    });
    const provider = createTerminalLinkProvider(terminalBuffer(rows), {
      confirm: () => true,
      open: () => true,
    });

    expect(provide(provider, 1)[0].range).toEqual({
      start: { x: 3, y: 1 },
      end: { x: 24, y: 1 },
    });
    expect(provide(provider, 2)[0].range).toEqual({
      start: { x: 3, y: 2 },
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
          start: { x: 6, y: 2 },
          end: { x: 21, y: 2 },
        },
      },
    ]);
  });

  it("does not expose a complete last-cell URL as direct when the next row is ambiguous", () => {
    const url = "https://example.test/a";
    const cols = url.length;
    const rows = [row(0, url, cols), row(1, "unrelated status", cols)];
    const inferred = `${url}unrelated`;

    expect(computeTerminalLinks(rows, 0)).toEqual([
      {
        text: inferred,
        requiresConfirmation: true,
        range: {
          start: { x: 1, y: 1 },
          end: { x: cols, y: 1 },
        },
      },
    ]);
    expect(computeTerminalLinks(rows, 1)).toEqual([
      {
        text: inferred,
        requiresConfirmation: true,
        range: {
          start: { x: 1, y: 2 },
          end: { x: "unrelated".length, y: 2 },
        },
      },
    ]);
  });

  it("treats a fresh HTTP scheme on the next row as a separate URL", () => {
    const first = "https://first.test/path";
    const second = "https://second.test/other";
    const cols = Math.max(first.length, second.length);
    const rows = [row(0, first.padEnd(cols, "x"), cols), row(1, second, cols)];
    const firstTarget = first.padEnd(cols, "x");

    expect(computeTerminalLinks(rows, 0).map((link) => link.text)).toEqual([
      firstTarget,
    ]);
    expect(computeTerminalLinks(rows, 1).map((link) => link.text)).toEqual([
      second,
    ]);
  });

  it.each(["?next=", "?source=terminal&url=", "#next="])(
    "keeps a fresh scheme as a query value after %s",
    (query) => {
      const first = `https://redirect.test/${query}`;
      const second = "https://dest.test/path";
      const target = `${first}${second}`;
      const cols = first.length;
      const confirm = vi.fn(() => true);
      const open = vi.fn(() => true);
      const provider = createTerminalLinkProvider(
        terminalBuffer([row(0, first, cols), row(1, second, cols)]),
        { confirm, open },
      );

      for (const requestedRow of [1, 2]) {
        const link = provide(provider, requestedRow)[0];
        expect(link).toMatchObject({
          text: target,
          range: {
            start: { y: requestedRow },
            end: { y: requestedRow },
          },
        });
        link.activate(new MouseEvent("click"), link.text);
      }
      expect(confirm).toHaveBeenCalledTimes(2);
      expect(confirm).toHaveBeenNthCalledWith(1, target);
      expect(confirm).toHaveBeenNthCalledWith(2, target);
      expect(open).toHaveBeenNthCalledWith(1, target);
      expect(open).toHaveBeenNthCalledWith(2, target);
    },
  );

  it("carries a nested URL assignment across three hard rows", () => {
    const parts = [
      "https://redirect.test/a?",
      "padding=1234567890&next=",
      "https://dest.test/path",
    ];
    const cols = parts[0].length;
    expect(parts[1]).toHaveLength(cols);
    const target = parts.join("");
    const confirm = vi.fn(() => true);
    const open = vi.fn(() => true);
    const provider = createTerminalLinkProvider(
      terminalBuffer(parts.map((part, index) => row(index, part, cols))),
      { confirm, open },
    );

    for (const requestedRow of [1, 2, 3]) {
      const link = provide(provider, requestedRow)[0];
      expect(link).toMatchObject({
        text: target,
        range: {
          start: { y: requestedRow },
          end: { y: requestedRow },
        },
      });
      link.activate(new MouseEvent("click"), link.text);
    }
    expect(confirm).toHaveBeenCalledTimes(3);
    expect(confirm).toHaveBeenNthCalledWith(1, target);
    expect(confirm).toHaveBeenNthCalledWith(2, target);
    expect(confirm).toHaveBeenNthCalledWith(3, target);
    expect(open).toHaveBeenCalledTimes(3);
    expect(open).toHaveBeenNthCalledWith(1, target);
    expect(open).toHaveBeenNthCalledWith(2, target);
    expect(open).toHaveBeenNthCalledWith(3, target);
  });

  it("does not treat an ampersand in a URL path as nested-URL query state", () => {
    const parts = [
      "https://redirect.test/path",
      "padding=123456789012&next=",
      "https://dest.test/path",
    ];
    const cols = parts[0].length;
    expect(parts[1]).toHaveLength(cols);
    const outerPath = `${parts[0]}${parts[1]}`;
    const rows = parts.map((part, index) => row(index, part, cols));

    expect(computeTerminalLinks(rows, 0).map((link) => link.text)).toEqual([
      outerPath,
    ]);
    expect(computeTerminalLinks(rows, 1).map((link) => link.text)).toEqual([
      outerPath,
    ]);
    expect(computeTerminalLinks(rows, 2).map((link) => link.text)).toEqual([
      parts[2],
    ]);
  });

  it.each([
    "- item",
    "* item",
    "# prompt",
    "$ prompt",
    "% prompt",
    "+ item",
    "1. item",
    "2) item",
    "a. item",
    "B) item",
    "user@host:~$ command",
    "PS C:\\> command",
    "[root@host ~]# command",
    "(venv) user@host:~$ command",
    "(.venv) $ command",
    "• bullet",
    "◦ bullet",
    "‣ bullet",
  ])("does not cross into a leading prompt or bullet row: %s", (nextText) => {
    const first = "https://example.test/path";
    const cols = first.length;
    const rows = [row(0, first, cols), row(1, nextText, cols)];

    expect(computeTerminalLinks(rows, 0).map((link) => link.text)).toEqual([
      first,
    ]);
    expect(computeTerminalLinks(rows, 1)).toEqual([]);
  });

  it("does not cross a blank hard row", () => {
    const first = "https://example.test/path";
    const cols = first.length;
    const rows = [row(0, first, cols), row(1, "", cols)];

    expect(computeTerminalLinks(rows, 0).map((link) => link.text)).toEqual([
      first,
    ]);
    expect(computeTerminalLinks(rows, 1)).toEqual([]);
  });

  it("requires the complete labeled gutter exterior to remain stable", () => {
    const trusted = "https://trusted.test";
    const evil = `@evil.test/${"x".repeat(trusted.length - "@evil.test/".length)}`;
    const makeLabeledRow = (index: number, label: string, content: string) => {
      const text = `${label} │ ${content} │ ${label}`;
      return row(index, text, text.length);
    };
    const rows = [
      makeLabeledRow(0, "A", trusted),
      makeLabeledRow(1, "B", evil),
    ];

    expect(computeTerminalLinks(rows, 0).map((link) => link.text)).toEqual([
      trusted,
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

  it.each([
    "https://example.test/download;",
    "https://example.test/?q=ready!",
    "https://example.test/#frag?",
  ])("preserves URL-valid final punctuation during activation: %s", (target) => {
    const confirm = vi.fn(() => true);
    const open = vi.fn(() => true);
    const provider = createTerminalLinkProvider(
      terminalBuffer([row(0, target, target.length + 4)]),
      { confirm, open },
    );

    const link = provide(provider, 1)[0];
    expect(link.text).toBe(target);
    link.activate(new MouseEvent("click"), link.text);
    expect(confirm).not.toHaveBeenCalled();
    expect(open).toHaveBeenCalledWith(target);
  });

  it("supports IPv6, credentials, ports, escapes, query/hash, and balanced parentheses", () => {
    const targets = [
      "https://[::1]",
      "https://[::1]:8443/path",
      "https://user:pass@example.test:8443/a%20b?q=x%2Fy#frag",
      "https://example.test/wiki/Foo_(bar)",
    ];
    const text = `${targets[0]} ${targets[1]}, ${targets[2]} ${targets[3]}.`;

    expect(
      computeTerminalLinks([row(0, text, text.length + 4)], 0).map(
        (link) => link.text,
      ),
    ).toEqual(targets);
  });

  it("trims unmatched sentence delimiters but keeps balanced URL delimiters", () => {
    const balanced = "https://example.test/wiki/Foo_(bar)";
    const ipv6 = "https://[::1]";
    const text = `${balanced}). ${ipv6}].`;

    expect(
      computeTerminalLinks([row(0, text, text.length + 2)], 0).map(
        (link) => link.text,
      ),
    ).toEqual([balanced, ipv6]);
  });

  it("trims a large unmatched delimiter suffix in a bounded number of passes", () => {
    const target = "https://example.test/path";
    const text = `${target}${")".repeat(1_024)}`;
    const source = row(0, text, text.length);
    const slice = vi.spyOn(String.prototype, "slice");

    try {
      expect(computeTerminalLinks([source], 0).map((link) => link.text)).toEqual([
        target,
      ]);
      // Counting full-string slice passes demonstrates bounded trimming without
      // relying on a machine-dependent wall-clock threshold.
      expect(slice.mock.calls.length).toBeLessThan(16);
    } finally {
      slice.mockRestore();
    }
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
          start: { x: 1, y: 2 },
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
          start: { x: 1, y: 2 },
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
  it("expands structurally beyond seventeen rows when the complete target is under budget", () => {
    const cols = 12;
    const url = `https://example.test/${"a".repeat(240)}`;
    const rows = rowsForUrl(url, cols);
    expect(rows.length).toBeGreaterThan(17);
    const provider = createTerminalLinkProvider(terminalBuffer(rows), {
      confirm: () => true,
      open: () => true,
    });

    for (const rowIndex of [0, Math.floor(rows.length / 2), rows.length - 1]) {
      const link = provide(provider, rowIndex + 1)[0];
      expect(link).toMatchObject({
        text: url,
        range: {
          start: { y: rowIndex + 1 },
          end: { y: rowIndex + 1 },
        },
      });
    }
  });

  it("guards a clipped local fragment instead of exposing it to lower providers", () => {
    const cols = 12;
    const url = `https://example.test/${"a".repeat(240)}`;
    const rows = rowsForUrl(url, cols);
    const confirm = vi.fn(() => true);
    const open = vi.fn(() => true);
    const provider = createTerminalLinkProvider(terminalBuffer(rows), {
      cellBudget: cols * 6,
      confirm,
      open,
    });

    const guard = provide(provider, 1)[0];
    expect(guard).toMatchObject({
      text: url.slice(0, cols),
      decorations: { pointerCursor: false, underline: false },
      range: {
        start: { x: 1, y: 1 },
        end: { x: cols, y: 1 },
      },
    });
    guard.activate(new MouseEvent("click"), guard.text);
    expect(confirm).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();

    expect(provide(provider, Math.floor(rows.length / 2) + 1)).toEqual([]);
    expect(provide(provider, rows.length)).toEqual([]);
  });

  it("guards a budget edge immediately before an early-wrapped wide glyph", () => {
    const prefix = "https://example.test/caf";
    const cols = prefix.length + 1;
    const firstCells = [
      ...cellsFromText(prefix, prefix.length),
      { chars: "", width: 1 },
    ];
    const secondCells: TerminalLinkCellSnapshot[] = [
      { chars: "中", width: 2 },
      { chars: "", width: 0 },
      ...cellsFromText("", cols - 2),
    ];
    const confirm = vi.fn(() => true);
    const open = vi.fn(() => true);
    const provider = createTerminalLinkProvider(
      terminalBuffer([
        { index: 0, isWrapped: false, cells: firstCells },
        { index: 1, isWrapped: true, cells: secondCells },
      ]),
      { cellBudget: cols, confirm, open },
    );

    const guard = provide(provider, 1)[0];
    expect(guard).toMatchObject({
      text: prefix,
      decorations: { pointerCursor: false, underline: false },
      range: {
        start: { x: 1, y: 1 },
        end: { x: prefix.length, y: 1 },
      },
    });
    guard.activate(new MouseEvent("click"), guard.text);
    expect(confirm).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });

  it("keeps an unrelated ordinary exact link navigable and unguarded", () => {
    const target = "https://ordinary.test/path";
    const confirm = vi.fn(() => true);
    const open = vi.fn(() => true);
    const provider = createTerminalLinkProvider(
      terminalBuffer([row(0, target, 40)]),
      { cellBudget: 40, confirm, open },
    );

    const link = provide(provider, 1)[0];
    expect(link.text).toBe(target);
    expect(link.decorations).toBeUndefined();
    link.activate(new MouseEvent("click"), link.text);
    expect(confirm).not.toHaveBeenCalled();
    expect(open).toHaveBeenCalledWith(target);
  });

  it("does not guard an exact link unrelated to a clipped row edge", () => {
    const target = "https://ordinary.test/x";
    const cols = target.length + 12;
    const first = `${target} ${"a".repeat(cols - target.length - 1)}`;
    const confirm = vi.fn(() => true);
    const open = vi.fn(() => true);
    const provider = createTerminalLinkProvider(
      terminalBuffer([
        row(0, first, cols),
        row(1, "possible continuation", cols),
      ]),
      { cellBudget: cols, confirm, open },
    );

    const link = provide(provider, 1)[0];
    expect(link.text).toBe(target);
    expect(link.decorations).toBeUndefined();
    link.activate(new MouseEvent("click"), link.text);
    expect(confirm).not.toHaveBeenCalled();
    expect(open).toHaveBeenCalledWith(target);
  });

  it("guards a fresh-scheme row when its possible query context is clipped", () => {
    const first = "https://redirect.test/?next=";
    const second = "https://dest.test/path";
    const cols = first.length;
    const confirm = vi.fn(() => true);
    const open = vi.fn(() => true);
    const provider = createTerminalLinkProvider(
      terminalBuffer([row(0, first, cols), row(1, second, cols)]),
      { cellBudget: cols, confirm, open },
    );

    const guard = provide(provider, 2)[0];
    expect(guard).toMatchObject({
      text: second,
      decorations: { pointerCursor: false, underline: false },
      range: {
        start: { x: 1, y: 2 },
        end: { x: second.length, y: 2 },
      },
    });
    guard.activate(new MouseEvent("click"), guard.text);
    expect(confirm).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });

  it("guards a nested scheme when the outer lexical context is clipped", () => {
    const parts = [
      "https://redirect.test/a?",
      "padding=1234567890&next=",
      "https://dest.test/path",
    ];
    const cols = parts[0].length;
    const confirm = vi.fn(() => true);
    const open = vi.fn(() => true);
    const provider = createTerminalLinkProvider(
      terminalBuffer(parts.map((part, index) => row(index, part, cols))),
      { cellBudget: cols * 2, confirm, open },
    );

    const guard = provide(provider, 3)[0];
    expect(guard).toMatchObject({
      text: parts[2],
      decorations: { pointerCursor: false, underline: false },
      range: {
        start: { x: 1, y: 3 },
        end: { x: parts[2].length, y: 3 },
      },
    });
    guard.activate(new MouseEvent("click"), guard.text);
    expect(confirm).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });

  it("guards a row whose combined-cell content exceeds the code-unit budget", () => {
    const target = "https://example.test/path";
    const cells: TerminalLinkCellSnapshot[] = [
      ...cellsFromText(target, target.length),
      { chars: `x${"\u0301".repeat(256)}`, width: 1 },
    ];
    const cols = cells.length;
    const confirm = vi.fn(() => true);
    const open = vi.fn(() => true);
    const provider = createTerminalLinkProvider(
      terminalBuffer([{ index: 0, isWrapped: false, cells }]),
      {
        cellBudget: cols,
        codeUnitBudget: target.length + 8,
        confirm,
        open,
      },
    );

    const guard = provide(provider, 1)[0];
    expect(guard).toMatchObject({
      text: target,
      decorations: { pointerCursor: false, underline: false },
      range: {
        start: { x: 1, y: 1 },
        end: { x: cols, y: 1 },
      },
    });
    guard.activate(new MouseEvent("click"), guard.text);
    expect(confirm).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });

  it("keeps a resolved exact link before a code-unit-clipped span navigable", () => {
    const target = "https://safe.test/path";
    const unresolved = [
      { chars: `x${"\u0301".repeat(256)}`, width: 1 },
      ...cellsFromText("https://hidden.test", 19),
    ];
    const cells: TerminalLinkCellSnapshot[] = [
      ...cellsFromText(target, target.length),
      { chars: " ", width: 1 },
      ...unresolved,
    ];
    const cols = cells.length;
    const firstUnresolvedX = target.length + 2;
    const confirm = vi.fn(() => true);
    const open = vi.fn(() => true);
    const provider = createTerminalLinkProvider(
      terminalBuffer([{ index: 0, isWrapped: false, cells }]),
      {
        cellBudget: cols,
        codeUnitBudget: target.length + 1,
        confirm,
        open,
      },
    );

    const links = provide(provider, 1);
    const exact = links.find((link) => !link.decorations);
    const guard = links.find((link) => link.decorations?.underline === false);
    expect(exact).toMatchObject({
      text: target,
      range: {
        start: { x: 1, y: 1 },
        end: { x: target.length, y: 1 },
      },
    });
    expect(guard).toMatchObject({
      range: {
        start: { x: firstUnresolvedX, y: 1 },
        end: { x: cols, y: 1 },
      },
      decorations: { pointerCursor: false, underline: false },
    });

    exact!.activate(new MouseEvent("click"), exact!.text);
    guard!.activate(new MouseEvent("click"), guard!.text);
    expect(confirm).not.toHaveBeenCalled();
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith(target);
  });

  it("keeps a resolved exact link before a cell-budget-clipped span navigable", () => {
    const target = "https://safe.test/path";
    const cols = target.length + 24;
    const inspectedText = `${target} `;
    const firstUnresolvedX = inspectedText.length + 1;
    const confirm = vi.fn(() => true);
    const open = vi.fn(() => true);
    const provider = createTerminalLinkProvider(
      terminalBuffer([
        row(0, `${inspectedText}https://hidden.test`, cols),
      ]),
      {
        cellBudget: inspectedText.length,
        confirm,
        open,
      },
    );

    const links = provide(provider, 1);
    const exact = links.find((link) => !link.decorations);
    const guard = links.find((link) => link.decorations?.underline === false);
    expect(exact?.text).toBe(target);
    expect(guard).toMatchObject({
      range: {
        start: { x: firstUnresolvedX, y: 1 },
        end: { x: cols, y: 1 },
      },
      decorations: { pointerCursor: false, underline: false },
    });

    exact!.activate(new MouseEvent("click"), exact!.text);
    guard!.activate(new MouseEvent("click"), guard!.text);
    expect(confirm).not.toHaveBeenCalled();
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith(target);
  });

  it("guards a raw token that only moves off the clipped edge after trimming", () => {
    const first = "https://example.";
    const second = "com/path";
    const cols = first.length;
    const confirm = vi.fn(() => true);
    const open = vi.fn(() => true);
    const provider = createTerminalLinkProvider(
      terminalBuffer([row(0, first, cols), row(1, second, cols)]),
      { cellBudget: cols, confirm, open },
    );

    const guard = provide(provider, 1)[0];
    expect(guard).toMatchObject({
      text: "https://example",
      range: {
        start: { x: 1, y: 1 },
        end: { x: cols, y: 1 },
      },
      decorations: { pointerCursor: false, underline: false },
    });
    guard.activate(new MouseEvent("click"), guard.text);
    expect(confirm).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });

  it("guards a stock-valid URL prefix when the clipped raw token is not parseable", () => {
    const text = "https://example.test[ rest";
    const cols = text.length;
    const confirm = vi.fn(() => true);
    const open = vi.fn(() => true);
    const provider = createTerminalLinkProvider(
      terminalBuffer([row(0, text, cols)]),
      { cellBudget: 21, confirm, open },
    );

    const links = provide(provider, 1);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      text: "https://example.test[",
      range: {
        start: { x: 1, y: 1 },
        end: { x: cols, y: 1 },
      },
      decorations: { pointerCursor: false, underline: false },
    });

    links[0].activate(new MouseEvent("click"), links[0].text);
    expect(confirm).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });

  it("unions nested and outer clipped guards before xterm can prune the outer range", () => {
    const inspected = "https://example.test[!https://nested.test";
    const text = `${inspected} rest`;
    const cols = text.length;
    const confirm = vi.fn(() => true);
    const open = vi.fn(() => true);
    const provider = createTerminalLinkProvider(
      terminalBuffer([row(0, text, cols)]),
      { cellBudget: inspected.length, confirm, open },
    );

    const links = provide(provider, 1);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      text: inspected,
      range: {
        start: { x: 1, y: 1 },
        end: { x: cols, y: 1 },
      },
      decorations: { pointerCursor: false, underline: false },
    });
    for (let x = 1; x <= cols; x++) {
      expect(
        links.filter(
          (link) => link.range.start.x <= x && link.range.end.x >= x,
        ),
        `normalized custom ownership at column ${x}`,
      ).toHaveLength(1);
    }

    links[0].activate(new MouseEvent("click"), links[0].text);
    expect(confirm).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });

  it("preserves a disjoint exact link before normalized clipped guards", () => {
    const safe = "https://safe.test/path";
    const inspected = "https://example.test[!https://nested.test";
    const text = `${safe} ${inspected} rest`;
    const cols = text.length;
    const guardStart = safe.length + 2;
    const confirm = vi.fn(() => true);
    const open = vi.fn(() => true);
    const provider = createTerminalLinkProvider(
      terminalBuffer([row(0, text, cols)]),
      {
        cellBudget: safe.length + 1 + inspected.length,
        confirm,
        open,
      },
    );

    const links = provide(provider, 1);
    expect(links).toHaveLength(2);
    const exact = links.find((link) => !link.decorations);
    const guard = links.find((link) => link.decorations?.underline === false);
    expect(exact).toMatchObject({
      text: safe,
      range: {
        start: { x: 1, y: 1 },
        end: { x: safe.length, y: 1 },
      },
    });
    expect(guard).toMatchObject({
      range: {
        start: { x: guardStart, y: 1 },
        end: { x: cols, y: 1 },
      },
      decorations: { pointerCursor: false, underline: false },
    });

    exact!.activate(new MouseEvent("click"), exact!.text);
    guard!.activate(new MouseEvent("click"), guard!.text);
    expect(confirm).not.toHaveBeenCalled();
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith(safe);
  });

  it("returns non-overlapping guards when a cell budget ends after a width-2 lead", () => {
    const prefix = "https://wide.test/";
    const hidden = "https://hidden.test";
    const cells: TerminalLinkCellSnapshot[] = [
      ...cellsFromText(prefix, prefix.length),
      { chars: "中", width: 2 },
      { chars: "", width: 0 },
      { chars: " ", width: 1 },
      ...cellsFromText(hidden, hidden.length),
    ];
    const cols = cells.length;
    const confirm = vi.fn(() => true);
    const open = vi.fn(() => true);
    const provider = createTerminalLinkProvider(
      terminalBuffer([{ index: 0, isWrapped: false, cells }]),
      { cellBudget: prefix.length + 1, confirm, open },
    );

    const guards = provide(provider, 1);
    expect(guards.length).toBeGreaterThan(0);
    for (let x = 1; x <= cols; x++) {
      expect(
        guards.filter(
          (guard) => guard.range.start.x <= x && guard.range.end.x >= x,
        ),
        `custom guard ownership at column ${x}`,
      ).toHaveLength(1);
    }
    for (const guard of guards) {
      expect(guard.decorations).toMatchObject({
        pointerCursor: false,
        underline: false,
      });
      guard.activate(new MouseEvent("click"), guard.text);
    }
    expect(confirm).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });

  it("owns the complete hard-row range and confirms its full target synchronously", () => {
    const url = "https://example.test/a-long/path?value=one";
    const terminal = terminalBuffer(rowsForUrl(url, 21));
    const confirm = vi.fn(() => false);
    const open = vi.fn(() => true);
    const provider = createTerminalLinkProvider(terminal, { confirm, open });

    const firstRowLink = provide(provider, 1)[0];
    const secondRowLink = provide(provider, 2)[0];
    expect(firstRowLink.text).toBe(url);
    expect(secondRowLink).toMatchObject({
      text: url,
      range: {
        start: { y: 2 },
        end: { y: 2 },
      },
    });

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
        end: { x: 24, y: 1 },
      },
    });
  });

  it("does not activate a cached link after the same cells are repainted", () => {
    const cols = 18;
    const oldUrl = "https://old.test/a-long/path";
    const rows = rowsForUrl(oldUrl, cols);
    const terminal = terminalBuffer(rows);
    const confirm = vi.fn(() => true);
    const open = vi.fn(() => true);
    const provider = createTerminalLinkProvider(terminal, { confirm, open });
    const cachedLink = provide(provider, 1)[0];

    rows.splice(
      0,
      rows.length,
      ...rowsForUrl("https://new.test/a-long/path", cols),
    );
    cachedLink.activate(new MouseEvent("click"), cachedLink.text);

    expect(confirm).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });

  it("does not activate a cached normal-buffer link after switching buffers", () => {
    const oldUrl = "https://normal.test/path";
    const terminal = terminalBuffer([row(0, oldUrl, 32)]);
    const confirm = vi.fn(() => true);
    const open = vi.fn(() => true);
    const provider = createTerminalLinkProvider(terminal, { confirm, open });
    const cachedLink = provide(provider, 1)[0];

    terminal.setActiveRows([row(0, "alternate screen", 32)]);
    cachedLink.activate(new MouseEvent("click"), cachedLink.text);

    expect(confirm).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });

  it("does not activate a cached exact link after it becomes a guard", () => {
    const target = "https://cached.test/path";
    const cols = target.length;
    const rows = [row(0, target, cols)];
    const terminal = terminalBuffer(rows);
    const confirm = vi.fn(() => true);
    const open = vi.fn(() => true);
    const provider = createTerminalLinkProvider(terminal, {
      cellBudget: cols,
      confirm,
      open,
    });
    const cachedLink = provide(provider, 1)[0];
    expect(cachedLink.decorations).toBeUndefined();

    rows.push(row(1, "possible continuation", cols));
    expect(provide(provider, 1)[0]).toMatchObject({
      text: target,
      range: cachedLink.range,
      decorations: { pointerCursor: false, underline: false },
    });
    cachedLink.activate(new MouseEvent("click"), cachedLink.text);

    expect(confirm).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });
});
