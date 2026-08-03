// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { routeTerminalClientFrame } from "../terminal-client-frame";

function route(raw: string) {
  const protocol = vi.fn();
  const ptyWrite = vi.fn();
  routeTerminalClientFrame(raw, {
    onProtocolMessage: protocol,
    onLegacyInput: ptyWrite,
  });
  return { protocol, ptyWrite };
}

describe("terminal client frame routing", () => {
  it.each([
    '{"type"',
    '{"type":"clipboard_write","data":"private","updateId":"one"',
    '{ "type" : "clipboard_subscribe", "enabled": tru',
    '{"type":"clipboard_write","data":"private",}',
    '{"data":"private","updateId":"one"',
    '{"type":"input","data":"must-not-fall-through"',
  ])("fails closed for malformed protocol-looking JSON", (raw) => {
    const { protocol, ptyWrite } = route(raw);

    expect(protocol).not.toHaveBeenCalled();
    expect(ptyWrite).not.toHaveBeenCalled();
  });

  it("never reroutes a protocol handler failure into legacy PTY input", () => {
    const ptyWrite = vi.fn();

    expect(() =>
      routeTerminalClientFrame(
        '{"type":"clipboard_write","data":"private","updateId":"one"}',
        {
          onProtocolMessage: () => {
            throw new Error("handler failed");
          },
          onLegacyInput: ptyWrite,
        },
      ),
    ).not.toThrow();
    expect(ptyWrite).not.toHaveBeenCalled();
  });

  it("preserves legitimate legacy raw terminal input", () => {
    expect(route("ls -la\r").ptyWrite).toHaveBeenCalledWith("ls -la\r");
    expect(route("{").ptyWrite).toHaveBeenCalledWith("{");
    expect(route("null").ptyWrite).toHaveBeenCalledWith("null");
    expect(route('{"data":"ordinary shell text"').ptyWrite).toHaveBeenCalledWith(
      '{"data":"ordinary shell text"',
    );
    expect(route('{"query":"ordinary shell text"').ptyWrite).toHaveBeenCalledWith(
      '{"query":"ordinary shell text"',
    );
  });

  it("routes valid protocol JSON only to the protocol handler", () => {
    const { protocol, ptyWrite } = route(
      '{"type":"clipboard_write","data":"private","updateId":"one"}',
    );

    expect(protocol).toHaveBeenCalledWith({
      type: "clipboard_write",
      data: "private",
      updateId: "one",
    });
    expect(ptyWrite).not.toHaveBeenCalled();
  });
});
