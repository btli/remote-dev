/**
 * Integration coverage against the installed xterm 6 implementation.
 *
 * This intentionally reaches into xterm's private provider registry and
 * render dimensions. The public API can register providers but cannot inspect
 * precedence or the active hover link, while happy-dom has no real layout.
 * Keeping the coupling here gives us direct evidence that the real Linkifier
 * selects the custom row-local segment ahead of WebLinksAddon's overlapping
 * first-row fragment.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { Terminal, type ILink, type ILinkProvider } from "@xterm/xterm";
import { WebLinksAddon } from "@xterm/addon-web-links";

import {
  createHttpLinkOpener,
  createTerminalLinkProvider,
} from "./terminal-links";

const COLS = 24;
const ROWS = 6;
const CELL_WIDTH = 8;
const CELL_HEIGHT = 16;

interface RenderDimensions {
  css: {
    cell: { width: number; height: number };
    canvas: { width: number; height: number };
  };
  device: {
    cell: { width: number; height: number };
    canvas: { width: number; height: number };
  };
}

interface RealXtermCore {
  _linkProviderService: { linkProviders: ILinkProvider[] };
  _charSizeService?: { width: number; height: number };
  _renderService?: { dimensions?: RenderDimensions };
  linkifier?: { currentLink?: { link: ILink } };
}

interface RealXtermInternals {
  _core: RealXtermCore;
}

function write(term: Terminal, data: string): Promise<void> {
  return new Promise((resolve) => term.write(data, resolve));
}

function provide(provider: ILinkProvider, row: number): ILink[] {
  let result: ILink[] | undefined;
  provider.provideLinks(row, (links) => {
    result = links;
  });
  return result ?? [];
}

function openRealTerminal(options: ConstructorParameters<typeof Terminal>[0] = {}) {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const term = new Terminal({
    allowProposedApi: true,
    cols: COLS,
    rows: ROWS,
    ...options,
  });
  term.open(parent);

  const screen = term.element!.querySelector(".xterm-screen") as HTMLElement;
  Object.defineProperty(screen, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      left: 0,
      top: 0,
      right: COLS * CELL_WIDTH,
      bottom: ROWS * CELL_HEIGHT,
      width: COLS * CELL_WIDTH,
      height: ROWS * CELL_HEIGHT,
      x: 0,
      y: 0,
      toJSON: () => "",
    }),
  });
  screen.style.paddingLeft = "0px";
  screen.style.paddingTop = "0px";

  const core = (term as unknown as RealXtermInternals)._core;
  if (core._charSizeService) {
    core._charSizeService.width = CELL_WIDTH;
    core._charSizeService.height = CELL_HEIGHT;
  }
  if (core._renderService) {
    Object.defineProperty(core._renderService, "dimensions", {
      configurable: true,
      get: (): RenderDimensions => ({
        css: {
          cell: { width: CELL_WIDTH, height: CELL_HEIGHT },
          canvas: { width: COLS * CELL_WIDTH, height: ROWS * CELL_HEIGHT },
        },
        device: {
          cell: { width: CELL_WIDTH, height: CELL_HEIGHT },
          canvas: { width: COLS * CELL_WIDTH, height: ROWS * CELL_HEIGHT },
        },
      }),
    });
  }

  return { term, parent, screen, core };
}

const disposals: Array<() => void> = [];

afterEach(() => {
  while (disposals.length > 0) disposals.pop()?.();
  document.body.innerHTML = "";
});

describe("terminal links against real xterm.js", () => {
  it("gives the custom row-local segment precedence over WebLinksAddon's fragment", async () => {
    const { term, parent, screen, core } = openRealTerminal();
    disposals.push(() => {
      term.dispose();
      parent.remove();
    });

    const target = "https://example.test/a-long-continuation";
    const first = target.slice(0, COLS);
    const second = target.slice(COLS);
    await write(term, `${first}\x1b[2;1H${second}`);
    expect(term.buffer.active.getLine(1)?.isWrapped).toBe(false);

    term.registerLinkProvider(
      createTerminalLinkProvider(term, {
        confirm: () => true,
        open: () => true,
      }),
    );
    term.loadAddon(new WebLinksAddon(() => {}));

    const providers = core._linkProviderService.linkProviders;
    expect(providers).toHaveLength(3);
    const custom = provide(providers[1], 1)[0];
    const stock = provide(providers[2], 1)[0];
    expect(custom).toMatchObject({
      text: target,
      range: {
        start: { x: 1, y: 1 },
        end: { x: COLS, y: 1 },
      },
    });
    expect(stock.text).toBe(first);
    expect(stock.range.start).toEqual(custom.range.start);
    expect(stock.range.end.y).toBeGreaterThanOrEqual(custom.range.end.y);

    screen.dispatchEvent(
      new MouseEvent("mousemove", {
        bubbles: true,
        clientX: CELL_WIDTH / 2,
        clientY: CELL_HEIGHT / 2,
      }),
    );
    expect(core.linkifier?.currentLink?.link.text).toBe(target);
    expect(core.linkifier?.currentLink?.link.range).toEqual(custom.range);
  });

  it("uses a non-navigating custom guard when the structural scan is clipped", async () => {
    const { term, parent, screen, core } = openRealTerminal();
    disposals.push(() => {
      term.dispose();
      parent.remove();
    });

    const target = "https://example.test/a-long-continuation";
    const first = target.slice(0, COLS);
    const second = target.slice(COLS);
    await write(term, `${first}\x1b[2;1H${second}`);
    expect(term.buffer.active.getLine(1)?.isWrapped).toBe(false);

    const confirm = vi.fn(() => true);
    const customOpen = vi.fn(() => true);
    const stockOpen = vi.fn();
    term.registerLinkProvider(
      createTerminalLinkProvider(term, {
        cellBudget: COLS,
        confirm,
        open: customOpen,
      }),
    );
    term.loadAddon(new WebLinksAddon((_event, text) => stockOpen(text)));

    const providers = core._linkProviderService.linkProviders;
    const guard = provide(providers[1], 1)[0];
    const stock = provide(providers[2], 1)[0];
    expect(guard).toMatchObject({
      text: first,
      decorations: { pointerCursor: false, underline: false },
      range: {
        start: { x: 1, y: 1 },
        end: { x: COLS, y: 1 },
      },
    });
    expect(stock.text).toBe(first);

    screen.dispatchEvent(
      new MouseEvent("mousemove", {
        bubbles: true,
        clientX: CELL_WIDTH / 2,
        clientY: CELL_HEIGHT / 2,
      }),
    );
    expect(core.linkifier?.currentLink?.link).toMatchObject({
      text: guard.text,
      range: guard.range,
    });

    screen.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        clientX: CELL_WIDTH / 2,
        clientY: CELL_HEIGHT / 2,
      }),
    );
    expect(confirm).not.toHaveBeenCalled();
    expect(customOpen).not.toHaveBeenCalled();
    expect(stockOpen).not.toHaveBeenCalled();
  });

  it("keeps OSC 8 first priority while filtering unsafe protocols", async () => {
    const openWindow = vi.fn(() => ({}) as Window);
    const safeOpen = createHttpLinkOpener(openWindow);
    const { term, parent, core } = openRealTerminal({
      linkHandler: {
        allowNonHttpProtocols: false,
        activate: (_event, text) => {
          safeOpen(text);
        },
      },
    });
    disposals.push(() => {
      term.dispose();
      parent.remove();
    });

    const unsafe = "javascript:alert(1)";
    const safe = "https://osc.test/path";
    await write(
      term,
      `\x1b]8;;${unsafe}\x1b\\unsafe\x1b]8;;\x1b\\` +
        `\x1b[2;1H\x1b]8;;${safe}\x1b\\safe\x1b]8;;\x1b\\`,
    );

    const oscProvider = core._linkProviderService.linkProviders[0];
    expect(provide(oscProvider, 1)).toEqual([]);
    const safeLink = provide(oscProvider, 2)[0];
    expect(safeLink.text).toBe(safe);
    safeLink.activate(new MouseEvent("click"), safeLink.text);
    expect(openWindow).toHaveBeenCalledWith(
      safe,
      "_blank",
      "noopener,noreferrer",
    );
  });
});
