# Flutter App — Phase 0: PWA Routes & JS Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the three mobile-only PWA routes (`/m/session/<id>`, `/m/channel/<id>`, `/m/recording/<id>`) and the `window.rdvBridge` JS adapter that the new Flutter app's WebView host will load.

**Architecture:** Each `/m/<surface>` route renders only its target surface — no `MobileShell`, no bottom tab bar, no app-wide chrome — wrapped in a thin set of providers needed by the surface. A route-group layout under `src/app/m/` excludes the desktop providers (and `MobileApp`'s tab shell) entirely. A new `rdv-bridge.ts` module exposes a versioned `window.rdvBridge` object whose methods are wired to terminal/session controls; outbound events go through `window.flutter_inappwebview.callHandler(...)` when present, otherwise no-op (so the routes still render in a desktop browser for testing).

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Vitest + happy-dom, existing `TerminalWithKeyboard` (`mobileChrome="external"`) as the terminal renderer, existing `MobileChannelView` and `RecordingPlayer`.

**Spec:** [`docs/superpowers/specs/2026-05-08-flutter-app-redesign-design.md`](../specs/2026-05-08-flutter-app-redesign-design.md) §4 (JS bridge contract), §10 (PWA-side work).

**Out of scope for this plan:** any Flutter / Dart code, native shell, FCM, biometric, deep links. Those land in subsequent plans (Phase 1, 1.5, 2…). This plan ships independently and is testable on its own — the `/m/*` routes render in a desktop browser and the bridge has unit tests.

---

## File Structure

**New files (10):**
- `src/lib/rdv-bridge.ts` — bridge module: defines `RdvBridge`, `RdvBridgeAdapter`, `installRdvBridge()`, `notifyToNative()` helpers
- `src/lib/__tests__/rdv-bridge.test.ts` — unit tests for bridge module
- `src/types/rdv-bridge.d.ts` — `Window` augmentation declaring `window.rdvBridge` and `window.flutter_inappwebview`
- `src/components/mobile/embed/EmbeddedSessionView.tsx` — terminal canvas only, wired to bridge
- `src/components/mobile/embed/EmbeddedChannelView.tsx` — channel + thread, wired to bridge for back/open-thread
- `src/components/mobile/embed/EmbeddedRecordingView.tsx` — recording playback, wired to bridge for back
- `src/components/mobile/embed/__tests__/EmbeddedSessionView.test.tsx` — render + bridge install test
- `src/app/m/layout.tsx` — minimal layout for `/m/*` routes (no AppShell, no MobileShell, no tab bar)
- `src/app/m/session/[id]/page.tsx` — server component → `EmbeddedSessionView`
- `src/app/m/channel/[id]/page.tsx` — server component → `EmbeddedChannelView`
- `src/app/m/recording/[id]/page.tsx` — server component → `EmbeddedRecordingView`

**Modified files (1):**
- `src/middleware.ts` — verify `/m/*` is auth-gated (it should already be, since middleware protects everything except `/login` and `/api`). No code change expected — this is a verification step.

---

## Bridge Contract Reference (from spec §4)

Native → WebView (calls into JS — these become methods on `window.rdvBridge`):

| Method | Signature | Purpose |
|---|---|---|
| `input` | `(text: string) => void` | Write text to terminal |
| `key` | `(name: string, mods: { ctrl?: boolean; alt?: boolean; shift?: boolean; meta?: boolean }) => void` | Smart-key press |
| `paste` | `(text: string) => void` | Paste from native clipboard |
| `setFontSize` | `(px: number) => void` | Pinch-zoom result |
| `scrollToBottom` | `() => void` | Snap to live |
| `back` | `() => void` | Channel/recording embed: signal "user pressed native back button" |

WebView → Native (calls JS that invokes `window.flutter_inappwebview.callHandler(name, payload)`):

| Event | Payload | Purpose |
|---|---|---|
| `onTerminalReady` | `{}` | Terminal initialized — native unlocks input + clears splash |
| `onSelectionChange` | `{ text: string }` | Native shows copy action sheet |
| `onWantsPaste` | `{}` | Long-press in WebView asks native for clipboard |
| `onActivity` | `{ state: "running" \| "waiting" \| "idle" \| "error" }` | Native status bar hint |
| `onLinkOpen` | `{ url: string }` | Native opens via in-app browser |

Bridge metadata:

| Field | Value |
|---|---|
| `window.rdvBridge.version` | `1` (numeric, bumped on breaking change) |

---

## Task 1: rdv-bridge module — types & no-op skeleton

**Files:**
- Create: `src/types/rdv-bridge.d.ts`
- Create: `src/lib/rdv-bridge.ts`
- Test: `src/lib/__tests__/rdv-bridge.test.ts`

- [ ] **Step 1: Write the global type declaration**

Create `src/types/rdv-bridge.d.ts`:

```typescript
/**
 * Global type declarations for the Flutter ↔ PWA JS bridge.
 *
 * `window.rdvBridge` — installed by `installRdvBridge()` when an
 *   embedded mobile route mounts. The native shell calls into these
 *   methods via `evaluateJavascript`.
 *
 * `window.flutter_inappwebview` — present only when running inside a
 *   `flutter_inappwebview`-hosted WebView. The bridge calls
 *   `.callHandler(name, payload)` to send events to native.
 */

import type { RdvBridge } from "@/lib/rdv-bridge";

declare global {
  interface Window {
    rdvBridge?: RdvBridge;
    flutter_inappwebview?: {
      callHandler: (name: string, ...args: unknown[]) => Promise<unknown>;
    };
  }
}

export {};
```

- [ ] **Step 2: Write the failing tests**

Create `src/lib/__tests__/rdv-bridge.test.ts`:

```typescript
/**
 * Tests for the rdv-bridge module — the JS surface the native Flutter
 * shell drives via window.rdvBridge, and the helper that emits events
 * back to native via window.flutter_inappwebview.callHandler.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RDV_BRIDGE_VERSION,
  installRdvBridge,
  notifyToNative,
  type RdvBridgeAdapter,
} from "../rdv-bridge";

function makeAdapter(overrides: Partial<RdvBridgeAdapter> = {}): RdvBridgeAdapter {
  return {
    input: vi.fn(),
    key: vi.fn(),
    paste: vi.fn(),
    setFontSize: vi.fn(),
    scrollToBottom: vi.fn(),
    back: vi.fn(),
    ...overrides,
  };
}

describe("rdv-bridge", () => {
  afterEach(() => {
    delete window.rdvBridge;
    delete window.flutter_inappwebview;
  });

  describe("installRdvBridge", () => {
    it("installs window.rdvBridge with the current version", () => {
      installRdvBridge(makeAdapter());

      expect(window.rdvBridge).toBeDefined();
      expect(window.rdvBridge?.version).toBe(RDV_BRIDGE_VERSION);
    });

    it("forwards input() calls to the adapter", () => {
      const adapter = makeAdapter();
      installRdvBridge(adapter);

      window.rdvBridge?.input("hello");

      expect(adapter.input).toHaveBeenCalledWith("hello");
    });

    it("forwards key() calls to the adapter with modifiers", () => {
      const adapter = makeAdapter();
      installRdvBridge(adapter);

      window.rdvBridge?.key("Tab", { ctrl: true });

      expect(adapter.key).toHaveBeenCalledWith("Tab", { ctrl: true });
    });

    it("forwards setFontSize, scrollToBottom, paste, back to the adapter", () => {
      const adapter = makeAdapter();
      installRdvBridge(adapter);

      window.rdvBridge?.setFontSize(14);
      window.rdvBridge?.scrollToBottom();
      window.rdvBridge?.paste("clip");
      window.rdvBridge?.back();

      expect(adapter.setFontSize).toHaveBeenCalledWith(14);
      expect(adapter.scrollToBottom).toHaveBeenCalledTimes(1);
      expect(adapter.paste).toHaveBeenCalledWith("clip");
      expect(adapter.back).toHaveBeenCalledTimes(1);
    });

    it("returns an uninstall function that removes the bridge", () => {
      const uninstall = installRdvBridge(makeAdapter());

      expect(window.rdvBridge).toBeDefined();
      uninstall();
      expect(window.rdvBridge).toBeUndefined();
    });

    it("re-installing replaces the previous adapter", () => {
      const first = makeAdapter();
      const second = makeAdapter();

      installRdvBridge(first);
      installRdvBridge(second);

      window.rdvBridge?.input("x");

      expect(first.input).not.toHaveBeenCalled();
      expect(second.input).toHaveBeenCalledWith("x");
    });
  });

  describe("notifyToNative", () => {
    it("calls window.flutter_inappwebview.callHandler when present", async () => {
      const callHandler = vi.fn().mockResolvedValue(undefined);
      window.flutter_inappwebview = { callHandler };

      await notifyToNative("onTerminalReady", {});

      expect(callHandler).toHaveBeenCalledWith("onTerminalReady", {});
    });

    it("is a no-op when window.flutter_inappwebview is absent", async () => {
      // No window.flutter_inappwebview installed — should not throw.
      await expect(
        notifyToNative("onActivity", { state: "running" })
      ).resolves.toBeUndefined();
    });

    it("forwards typed payloads", async () => {
      const callHandler = vi.fn().mockResolvedValue(undefined);
      window.flutter_inappwebview = { callHandler };

      await notifyToNative("onSelectionChange", { text: "selected" });
      await notifyToNative("onLinkOpen", { url: "https://example.com" });

      expect(callHandler).toHaveBeenNthCalledWith(1, "onSelectionChange", {
        text: "selected",
      });
      expect(callHandler).toHaveBeenNthCalledWith(2, "onLinkOpen", {
        url: "https://example.com",
      });
    });
  });
});
```

- [ ] **Step 3: Run tests — verify they fail**

Run: `bun run test:run src/lib/__tests__/rdv-bridge.test.ts`
Expected: FAIL — module not found (`Cannot find module ../rdv-bridge`).

- [ ] **Step 4: Write the bridge module**

Create `src/lib/rdv-bridge.ts`:

```typescript
/**
 * rdv-bridge — JS surface for the native Flutter shell.
 *
 * The native WebView host calls these methods via `evaluateJavascript`
 * to drive the embedded surface (terminal, channel, recording). The
 * embedded surface exports an "adapter" — a set of callbacks pointing
 * at the actual terminal / view APIs — and `installRdvBridge` glues
 * them onto `window.rdvBridge`.
 *
 * Events going the other way (terminal-ready, selection-change, link-
 * open) call `notifyToNative()` which dispatches via
 * `window.flutter_inappwebview.callHandler` when present and is a no-op
 * otherwise — this lets the same routes render in a desktop browser
 * for testing.
 *
 * @see docs/superpowers/specs/2026-05-08-flutter-app-redesign-design.md §4
 */

/** Bumped on any breaking change to the bridge surface. */
export const RDV_BRIDGE_VERSION = 1;

export interface RdvBridgeKeyMods {
  ctrl?: boolean;
  alt?: boolean;
  shift?: boolean;
  meta?: boolean;
}

/**
 * Adapter contract — the embedded view's hooks into its underlying
 * controls. Every method must be safe to call multiple times and from
 * any frame after the view has mounted.
 */
export interface RdvBridgeAdapter {
  /** Write text to the terminal (session view only). */
  input: (text: string) => void;
  /** Send a named key with optional modifiers (session view only). */
  key: (name: string, mods: RdvBridgeKeyMods) => void;
  /** Paste from native clipboard into the terminal (session view only). */
  paste: (text: string) => void;
  /** Set terminal font size in px (session view only). */
  setFontSize: (px: number) => void;
  /** Scroll terminal viewport to the bottom (session view only). */
  scrollToBottom: () => void;
  /** Native back button pressed — embed view should clean up / leave. */
  back: () => void;
}

/**
 * Public shape of `window.rdvBridge`. Methods that an adapter doesn't
 * implement (e.g., a channel embed has no `input`) are still installed,
 * but the adapter's no-op stubs absorb the call.
 */
export interface RdvBridge extends RdvBridgeAdapter {
  readonly version: number;
}

/**
 * Install `window.rdvBridge` backed by `adapter`. Returns an uninstall
 * function that should be called on view unmount.
 */
export function installRdvBridge(adapter: RdvBridgeAdapter): () => void {
  const bridge: RdvBridge = {
    version: RDV_BRIDGE_VERSION,
    input: (text) => adapter.input(text),
    key: (name, mods) => adapter.key(name, mods),
    paste: (text) => adapter.paste(text),
    setFontSize: (px) => adapter.setFontSize(px),
    scrollToBottom: () => adapter.scrollToBottom(),
    back: () => adapter.back(),
  };

  window.rdvBridge = bridge;

  return () => {
    if (window.rdvBridge === bridge) {
      delete window.rdvBridge;
    }
  };
}

/** Names of events the embedded view emits to native. */
export type NotifyName =
  | "onTerminalReady"
  | "onSelectionChange"
  | "onWantsPaste"
  | "onActivity"
  | "onLinkOpen";

/** Payload union — kept narrow on purpose; bump version to extend. */
export type NotifyPayload =
  | { name: "onTerminalReady"; data: Record<string, never> }
  | { name: "onSelectionChange"; data: { text: string } }
  | { name: "onWantsPaste"; data: Record<string, never> }
  | {
      name: "onActivity";
      data: { state: "running" | "waiting" | "idle" | "error" };
    }
  | { name: "onLinkOpen"; data: { url: string } };

/**
 * Send an event to the native shell. No-op when not running inside a
 * `flutter_inappwebview`-hosted WebView (so desktop browser rendering
 * during development still works).
 */
export async function notifyToNative<N extends NotifyName>(
  name: N,
  data: Extract<NotifyPayload, { name: N }>["data"]
): Promise<void> {
  const handler = window.flutter_inappwebview?.callHandler;
  if (!handler) return;
  await handler(name, data);
}
```

- [ ] **Step 5: Run tests — verify they pass**

Run: `bun run test:run src/lib/__tests__/rdv-bridge.test.ts`
Expected: PASS — all 10 tests pass.

- [ ] **Step 6: Run typecheck**

Run: `bun run typecheck`
Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add src/types/rdv-bridge.d.ts src/lib/rdv-bridge.ts src/lib/__tests__/rdv-bridge.test.ts
git commit -m "feat(mobile/bridge): add window.rdvBridge JS adapter for native shell

Defines the versioned bridge contract (v1) the new Flutter app's WebView
host will drive: input, key, paste, setFontSize, scrollToBottom, back —
and the notifyToNative() helper for outbound events. No-ops when not
running inside a flutter_inappwebview WebView so /m/* routes still render
in a desktop browser during development.

Spec: docs/superpowers/specs/2026-05-08-flutter-app-redesign-design.md §4

Co-authored-by: Isaac"
```

---

## Task 2: EmbeddedSessionView — terminal canvas + bridge wiring

**Files:**
- Create: `src/components/mobile/embed/EmbeddedSessionView.tsx`
- Create: `src/components/mobile/embed/__tests__/EmbeddedSessionView.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/components/mobile/embed/__tests__/EmbeddedSessionView.test.tsx`:

```typescript
/**
 * EmbeddedSessionView tests.
 *
 * Verifies that:
 *   1. The view renders the terminal area.
 *   2. Mounting installs window.rdvBridge.
 *   3. Unmounting uninstalls window.rdvBridge.
 *   4. window.rdvBridge.input forwards into the terminal's sendInput.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";

import { EmbeddedSessionView } from "../EmbeddedSessionView";

// Mock TerminalWithKeyboard — we just need its ref shape.
vi.mock("@/components/terminal/TerminalWithKeyboard", () => {
  const React =
    require("react") as typeof import("react");
  const TerminalWithKeyboard = React.forwardRef<
    {
      sendInput: (s: string) => void;
      scrollToBottom: () => void;
      focus: () => void;
      restartAgent: () => void;
    },
    Record<string, unknown>
  >(function MockTerminal(_props, ref) {
    React.useImperativeHandle(ref, () => ({
      sendInput: vi.fn(),
      scrollToBottom: vi.fn(),
      focus: vi.fn(),
      restartAgent: vi.fn(),
    }));
    return React.createElement(
      "div",
      { "data-testid": "terminal-mock" },
      "terminal"
    );
  });
  return { TerminalWithKeyboard };
});

const session = {
  id: "session-1",
  name: "test session",
  tmuxSessionName: "rdv-session-1",
  status: "active" as const,
};

afterEach(() => {
  cleanup();
  delete window.rdvBridge;
});

describe("EmbeddedSessionView", () => {
  it("renders the terminal area", () => {
    const { getByTestId } = render(
      <EmbeddedSessionView session={session} wsUrl="ws://localhost:6002" />
    );

    expect(getByTestId("terminal-mock")).toBeTruthy();
  });

  it("installs window.rdvBridge on mount", () => {
    expect(window.rdvBridge).toBeUndefined();

    render(<EmbeddedSessionView session={session} wsUrl="ws://localhost:6002" />);

    expect(window.rdvBridge).toBeDefined();
    expect(window.rdvBridge?.version).toBe(1);
  });

  it("uninstalls window.rdvBridge on unmount", () => {
    const { unmount } = render(
      <EmbeddedSessionView session={session} wsUrl="ws://localhost:6002" />
    );
    expect(window.rdvBridge).toBeDefined();

    unmount();

    expect(window.rdvBridge).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

Run: `bun run test:run src/components/mobile/embed/__tests__/EmbeddedSessionView.test.tsx`
Expected: FAIL — `Cannot find module '../EmbeddedSessionView'`.

- [ ] **Step 3: Implement EmbeddedSessionView**

Create `src/components/mobile/embed/EmbeddedSessionView.tsx`:

```typescript
"use client";

/**
 * EmbeddedSessionView — terminal canvas only, wired to the rdv-bridge.
 *
 * Rendered by `/m/session/[id]/page.tsx` inside a layout that excludes
 * MobileShell and the bottom tab bar. The native Flutter shell wraps
 * this view and supplies its own status bar, smart-key strip, and input
 * bar — those are NOT rendered here.
 *
 * On mount we install `window.rdvBridge` with handlers backed by the
 * terminal's imperative API (`sendInput`, `scrollToBottom`, etc). On
 * unmount we uninstall the bridge so the next route can install its
 * own.
 *
 * Outbound events:
 *   - onTerminalReady fires after the terminal mounts (microtask) so
 *     the native shell can clear its splash screen.
 *
 * @see docs/superpowers/specs/2026-05-08-flutter-app-redesign-design.md §4
 */

import { useEffect, useRef } from "react";

import {
  TerminalWithKeyboard,
  type TerminalWithKeyboardRef,
} from "@/components/terminal/TerminalWithKeyboard";
import {
  installRdvBridge,
  notifyToNative,
  type RdvBridgeAdapter,
  type RdvBridgeKeyMods,
} from "@/lib/rdv-bridge";

export interface EmbeddedSessionViewProps {
  session: {
    id: string;
    name: string;
    tmuxSessionName: string;
    status: "active" | "suspended" | "closed";
  };
  wsUrl: string;
  initialFontSize?: number;
}

/** Map a smart-key name + mods into the byte sequence the PTY expects. */
function keyToBytes(name: string, mods: RdvBridgeKeyMods): string {
  // Minimal mapping for v1 — extended in later phases as the native
  // smart-key strip lights up more keys. Unknown names are dropped to
  // avoid sending garbage to the PTY.
  if (mods.ctrl && name.length === 1) {
    // Ctrl+letter → control byte (only A-Z covered).
    const upper = name.toUpperCase().charCodeAt(0);
    if (upper >= 65 && upper <= 90) {
      return String.fromCharCode(upper - 64);
    }
  }
  switch (name) {
    case "Tab":
      return "\t";
    case "Escape":
    case "Esc":
      return "\x1b";
    case "Enter":
      return "\r";
    case "ArrowUp":
      return "\x1b[A";
    case "ArrowDown":
      return "\x1b[B";
    case "ArrowRight":
      return "\x1b[C";
    case "ArrowLeft":
      return "\x1b[D";
    case "Home":
      return "\x1b[H";
    case "End":
      return "\x1b[F";
    case "PageUp":
      return "\x1b[5~";
    case "PageDown":
      return "\x1b[6~";
    default:
      return "";
  }
}

export function EmbeddedSessionView({
  session,
  wsUrl,
  initialFontSize,
}: EmbeddedSessionViewProps) {
  const terminalRef = useRef<TerminalWithKeyboardRef | null>(null);

  useEffect(() => {
    const adapter: RdvBridgeAdapter = {
      input: (text) => terminalRef.current?.sendInput(text),
      key: (name, mods) => {
        const bytes = keyToBytes(name, mods);
        if (bytes) terminalRef.current?.sendInput(bytes);
      },
      paste: (text) => terminalRef.current?.sendInput(text),
      setFontSize: (_px) => {
        // Phase 0 stub — pinch-zoom font size lands in Phase 2 alongside
        // the native pinch gesture; for now we ignore so the bridge
        // method is callable without effect.
      },
      scrollToBottom: () => terminalRef.current?.scrollToBottom(),
      back: () => {
        // Session embed has no in-WebView "back" action — native shell
        // pops the route. Stub.
      },
    };

    const uninstall = installRdvBridge(adapter);
    // Fire onTerminalReady after the terminal ref resolves. Mount order
    // means the ref is populated by this effect's first run.
    queueMicrotask(() => void notifyToNative("onTerminalReady", {}));

    return uninstall;
  }, []);

  return (
    <div className="relative h-full w-full bg-[#1a1b26]">
      <TerminalWithKeyboard
        ref={terminalRef}
        sessionId={session.id}
        tmuxSessionName={session.tmuxSessionName}
        sessionName={session.name}
        wsUrl={wsUrl}
        fontSize={initialFontSize}
        mobileChrome="external"
      />
    </div>
  );
}
```

- [ ] **Step 4: Run test — verify it passes**

Run: `bun run test:run src/components/mobile/embed/__tests__/EmbeddedSessionView.test.tsx`
Expected: PASS — all 3 tests pass.

- [ ] **Step 5: Run typecheck**

Run: `bun run typecheck`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/mobile/embed/EmbeddedSessionView.tsx src/components/mobile/embed/__tests__/EmbeddedSessionView.test.tsx
git commit -m "feat(mobile/embed): EmbeddedSessionView wires terminal to rdv-bridge

Renders only the terminal canvas (no status bar, no smart-keys, no input
bar — those go native in the Flutter shell). Installs window.rdvBridge
on mount with handlers backed by the terminal's sendInput +
scrollToBottom; uninstalls on unmount; fires onTerminalReady after
mount so native can clear its splash.

Co-authored-by: Isaac"
```

---

## Task 3: EmbeddedChannelView — channel reuse + back-bridge

**Files:**
- Create: `src/components/mobile/embed/EmbeddedChannelView.tsx`

- [ ] **Step 1: Implement EmbeddedChannelView**

(No test file in this task — the existing `MobileChannelView` is already covered by `src/components/mobile/channels/__tests__/MobileChannelView.test.tsx`. The wrapper is a thin pass-through and will be exercised by the Phase 0 manual smoke test.)

Create `src/components/mobile/embed/EmbeddedChannelView.tsx`:

```typescript
"use client";

/**
 * EmbeddedChannelView — channel list / view / thread, no app chrome.
 *
 * Reuses the existing MobileChannelView. On mount we install a minimal
 * window.rdvBridge whose only meaningful method is `back`, which fires
 * an "onBack" — equivalent to user tapping the native back button. The
 * native shell will translate that into popping the route.
 *
 * Other rdvBridge methods (input, key, paste, setFontSize,
 * scrollToBottom) are stubbed since the channel surface doesn't drive
 * a terminal.
 */

import { useEffect, useState } from "react";

import { MobileChannelView } from "@/components/mobile/channels/MobileChannelView";
import { MobileThreadTakeover } from "@/components/mobile/channels/MobileThreadTakeover";
import { installRdvBridge, type RdvBridgeAdapter } from "@/lib/rdv-bridge";

const noop = () => {};

export function EmbeddedChannelView() {
  const [openThreadId, setOpenThreadId] = useState<string | null>(null);

  useEffect(() => {
    const adapter: RdvBridgeAdapter = {
      input: noop,
      key: noop,
      paste: noop,
      setFontSize: noop,
      scrollToBottom: noop,
      back: () => {
        // Closing an open thread takes priority over leaving the route.
        if (openThreadId) {
          setOpenThreadId(null);
        }
        // Otherwise this is a no-op; the native shell pops the route
        // itself based on its own back-stack state.
      },
    };
    return installRdvBridge(adapter);
  }, [openThreadId]);

  return (
    <div className="relative h-full w-full bg-[#1a1b26]">
      <MobileChannelView
        onBack={noop}
        onOpenThread={(id) => setOpenThreadId(id)}
      />
      {openThreadId && (
        <MobileThreadTakeover
          threadId={openThreadId}
          onClose={() => setOpenThreadId(null)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: 0 errors. If `MobileThreadTakeover` has a different prop shape, adjust the import to match the existing export and re-run. The fix is determined by reading the file:

```bash
head -40 src/components/mobile/channels/MobileThreadTakeover.tsx
```

…then update the JSX to match the actual prop names.

- [ ] **Step 3: Commit**

```bash
git add src/components/mobile/embed/EmbeddedChannelView.tsx
git commit -m "feat(mobile/embed): EmbeddedChannelView wraps MobileChannelView for native shell

Reuses MobileChannelView and MobileThreadTakeover with minimal local
state for the thread takeover. window.rdvBridge.back() closes an open
thread first, otherwise no-op (native shell pops the route).

Co-authored-by: Isaac"
```

---

## Task 4: EmbeddedRecordingView — recording playback wrapper

**Files:**
- Create: `src/components/mobile/embed/EmbeddedRecordingView.tsx`

- [ ] **Step 1: Read existing RecordingPlayer prop shape**

Run: `head -50 src/components/terminal/RecordingPlayer.tsx`
Read the `RecordingPlayerProps` interface and note its required props (likely `recordingId` and a fetch callback).

- [ ] **Step 2: Implement EmbeddedRecordingView**

Create `src/components/mobile/embed/EmbeddedRecordingView.tsx`:

```typescript
"use client";

/**
 * EmbeddedRecordingView — recording playback only, no app chrome.
 *
 * Wraps the existing RecordingPlayer. window.rdvBridge.back() is the
 * only meaningful native-driven action; everything else is stubbed.
 */

import { useEffect } from "react";

import { RecordingPlayer } from "@/components/terminal/RecordingPlayer";
import { installRdvBridge, type RdvBridgeAdapter } from "@/lib/rdv-bridge";

const noop = () => {};

export interface EmbeddedRecordingViewProps {
  recordingId: string;
}

export function EmbeddedRecordingView({
  recordingId,
}: EmbeddedRecordingViewProps) {
  useEffect(() => {
    const adapter: RdvBridgeAdapter = {
      input: noop,
      key: noop,
      paste: noop,
      setFontSize: noop,
      scrollToBottom: noop,
      back: noop, // native shell pops the route
    };
    return installRdvBridge(adapter);
  }, []);

  return (
    <div className="relative h-full w-full bg-[#1a1b26]">
      <RecordingPlayer recordingId={recordingId} />
    </div>
  );
}
```

If `RecordingPlayer`'s actual props differ from `{ recordingId: string }` (e.g., it expects a pre-fetched recording object), adjust the wrapper to match. Re-read step 1's output to confirm the contract.

- [ ] **Step 3: Run typecheck**

Run: `bun run typecheck`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/mobile/embed/EmbeddedRecordingView.tsx
git commit -m "feat(mobile/embed): EmbeddedRecordingView wraps RecordingPlayer for native shell

Co-authored-by: Isaac"
```

---

## Task 5: `/m/*` route group — minimal layout

**Files:**
- Create: `src/app/m/layout.tsx`

- [ ] **Step 1: Implement the minimal layout**

Create `src/app/m/layout.tsx`:

```typescript
/**
 * Layout for /m/* mobile-embed routes.
 *
 * These routes are loaded by the new Flutter app's WebView host and
 * render only their target surface (terminal, channel, recording) —
 * no MobileShell, no bottom tab bar, no AppShell.
 *
 * Auth gating is handled by `src/middleware.ts` (which protects every
 * route except /login and /api). When CF Access challenges, the
 * challenge happens *inside* the WebView and lands the user back here
 * with a CF_Authorization cookie set on the WebView's cookie store —
 * see spec §3.
 *
 * We deliberately do NOT mount the heavy desktop providers
 * (Template, Recording, Trash, Schedule, Secrets, GitHubAccount, …) so
 * the embed bundle stays lean. Surface-specific providers live inside
 * each surface's page.
 */

import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "Remote Dev",
  description: "Remote Dev mobile embed",
};

export const viewport: Viewport = {
  themeColor: "#1a1b26",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  viewportFit: "cover",
};

export default function MobileEmbedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="relative h-[100dvh] w-full overflow-hidden bg-[#1a1b26]">
      {children}
    </div>
  );
}
```

- [ ] **Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/m/layout.tsx
git commit -m "feat(mobile/embed): minimal /m/* layout for Flutter WebView host

No MobileShell, no bottom tab bar, no AppShell. Auth gating remains
handled by middleware. Provides only the bg color + viewport hints.

Co-authored-by: Isaac"
```

---

## Task 6: `/m/session/[id]` page — server component

**Files:**
- Create: `src/app/m/session/[id]/page.tsx`

- [ ] **Step 1: Read the existing session page pattern**

Look at how the existing root `src/app/page.tsx` resolves auth + loads providers + reads session data. We'll follow the same pattern but only mount what `EmbeddedSessionView` needs (none of the desktop providers).

Run: `sed -n '50,150p' src/app/page.tsx`
Note the use of `getAuthSession()`, `db.query.terminalSessions.findFirst(...)`, and the providers.

- [ ] **Step 2: Implement the page**

Create `src/app/m/session/[id]/page.tsx`:

```typescript
export const dynamic = "force-dynamic";

/**
 * /m/session/[id] — terminal-only session view for the native Flutter
 * shell's WebView host.
 *
 * Auth: resolved via `getAuthSession()` (NextAuth credentials OR CF
 * Access JWT). Unauthenticated requests are redirected to /login by
 * `src/middleware.ts` before they reach this page.
 *
 * Session: loaded from DB by id; 404 if not found or not owned by the
 * current user.
 *
 * Providers: deliberately none — `EmbeddedSessionView` only needs the
 * session row + the WebSocket URL. No SessionContext / ProjectTree /
 * Preferences are mounted, keeping the bundle lean.
 */

import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { db } from "@/db";
import { getAuthSession } from "@/lib/auth-utils";
import { EmbeddedSessionView } from "@/components/mobile/embed/EmbeddedSessionView";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function MobileSessionPage({ params }: PageProps) {
  const { id } = await params;
  const auth = await getAuthSession();
  if (!auth?.user?.email) {
    redirect("/login");
  }

  const row = await db.query.terminalSessions.findFirst({
    where: (s, { eq, and }) => and(eq(s.id, id), eq(s.userEmail, auth.user!.email!)),
  });
  if (!row) notFound();

  // Resolve WS URL from the request host so the WebView talks back to
  // the same Remote Dev origin it loaded the page from. The terminal
  // server runs on $TERMINAL_PORT (default 6002) on the same host.
  const h = await headers();
  const host = h.get("host") ?? "localhost";
  const proto = h.get("x-forwarded-proto") ?? "http";
  const wsProto = proto === "https" ? "wss" : "ws";
  const terminalPort = process.env.NEXT_PUBLIC_TERMINAL_PORT ?? "6002";
  const hostNoPort = host.split(":")[0];
  const wsUrl = `${wsProto}://${hostNoPort}:${terminalPort}`;

  return (
    <EmbeddedSessionView
      session={{
        id: row.id,
        name: row.name,
        tmuxSessionName: row.tmuxSessionName,
        status: row.status as "active" | "suspended" | "closed",
      }}
      wsUrl={wsUrl}
    />
  );
}
```

- [ ] **Step 3: Run typecheck**

Run: `bun run typecheck`
Expected: 0 errors.

If `getAuthSession()` returns a different shape than `{ user: { email } }`, adjust the destructuring. Confirm shape:

```bash
grep -n "export.*getAuthSession\|return " src/lib/auth-utils.ts | head
```

If `terminalSessions` schema uses a different user reference column (e.g. `userId` not `userEmail`), update the query accordingly:

```bash
grep -n "userEmail\|userId" src/db/schema.ts | grep -i terminal | head
```

- [ ] **Step 4: Commit**

```bash
git add src/app/m/session/[id]/page.tsx
git commit -m "feat(mobile/embed): /m/session/[id] route for native Flutter shell

Server component resolves auth + loads session row + computes ws URL,
then renders EmbeddedSessionView. No app-wide providers — the embed
bundle stays minimal.

Co-authored-by: Isaac"
```

---

## Task 7: `/m/channel/[id]` page

**Files:**
- Create: `src/app/m/channel/[id]/page.tsx`

- [ ] **Step 1: Implement the page**

Create `src/app/m/channel/[id]/page.tsx`:

```typescript
export const dynamic = "force-dynamic";

/**
 * /m/channel/[id] — single-channel view for the native Flutter shell.
 *
 * Auth handled by middleware. The ChannelProvider is mounted here
 * (not in the layout) so other /m/* surfaces don't pay for it.
 */

import { redirect } from "next/navigation";

import { ChannelProvider } from "@/contexts/ChannelContext";
import { EmbeddedChannelView } from "@/components/mobile/embed/EmbeddedChannelView";
import { getAuthSession } from "@/lib/auth-utils";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function MobileChannelPage({ params }: PageProps) {
  // Resolve params (ensures Next.js's async-params requirement is met)
  // and auth.
  await params;
  const auth = await getAuthSession();
  if (!auth?.user?.email) redirect("/login");

  return (
    <ChannelProvider>
      <EmbeddedChannelView />
    </ChannelProvider>
  );
}
```

If `ChannelProvider` requires an `initialChannelId` prop (likely — the deep-link target should pre-select that channel), add it:

```bash
grep -n "ChannelProviderProps\|interface .*Provider" src/contexts/ChannelContext.tsx | head
```

…then update the page to pass `initialChannelId={id}` (where `id` comes from the resolved params).

- [ ] **Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: 0 errors. If `ChannelProvider` has required props that aren't passed, the typecheck will tell you exactly which.

- [ ] **Step 3: Commit**

```bash
git add src/app/m/channel/[id]/page.tsx
git commit -m "feat(mobile/embed): /m/channel/[id] route for native Flutter shell

Co-authored-by: Isaac"
```

---

## Task 8: `/m/recording/[id]` page

**Files:**
- Create: `src/app/m/recording/[id]/page.tsx`

- [ ] **Step 1: Implement the page**

Create `src/app/m/recording/[id]/page.tsx`:

```typescript
export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";

import { EmbeddedRecordingView } from "@/components/mobile/embed/EmbeddedRecordingView";
import { getAuthSession } from "@/lib/auth-utils";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function MobileRecordingPage({ params }: PageProps) {
  const { id } = await params;
  const auth = await getAuthSession();
  if (!auth?.user?.email) redirect("/login");

  return <EmbeddedRecordingView recordingId={id} />;
}
```

- [ ] **Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/m/recording/[id]/page.tsx
git commit -m "feat(mobile/embed): /m/recording/[id] route for native Flutter shell

Co-authored-by: Isaac"
```

---

## Task 9: Verify auth-gating + middleware coverage

**Files:** none modified — verification only.

- [ ] **Step 1: Read the middleware**

Run: `cat src/middleware.ts`
Confirm the matcher excludes only `/login`, `/api`, and a few static-asset paths. `/m/*` should be implicitly protected because it's not in the excluded list.

- [ ] **Step 2: Confirm `/m/*` is not in the public allowlist**

Run: `grep -n "/m/\|/m/.*\\$\\|/m\\b" src/middleware.ts || echo "no /m allowlist — protected by default"`
Expected: "no /m allowlist — protected by default".

- [ ] **Step 3: Boot dev and curl an unauth request**

In one terminal:
```bash
bun run dev
```

In another:
```bash
curl -I http://localhost:6001/m/session/00000000-0000-0000-0000-000000000000
```
Expected: `HTTP/1.1 307 Temporary Redirect` with `location: /login` (NextAuth redirect).

- [ ] **Step 4: Stop dev and commit nothing**

No code changes — this is a verification step. If any of the above failed, file a follow-up beads issue:

```bash
bd create --title="middleware does not protect /m/* routes" \
  --description="Phase 0 verification turned up that /m/<id> is reachable without auth. Audit src/middleware.ts and add to protected paths. Repro: curl -I http://localhost:6001/m/session/<uuid> while logged out." \
  --type=bug --priority=1
```

---

## Task 10: Manual smoke test in desktop browser

**Files:** none.

- [ ] **Step 1: Boot dev**

Run: `bun run dev`

- [ ] **Step 2: Sign in as the local credentials user**

Open `http://localhost:6001/login`, sign in.

- [ ] **Step 3: Create a session via the normal UI**

Use the existing UI to create a session. Note its UUID from the URL or DevTools.

- [ ] **Step 4: Open the embed route**

Visit `http://localhost:6001/m/session/<id>` in a desktop browser.

Expected:
- Page renders the terminal canvas full-bleed on a dark background.
- No bottom tab bar, no smart-key strip, no input bar (those go native in Phase 2).
- The terminal is responsive to keyboard input from the desktop keyboard (the `mobileChrome="external"` mode still wires xterm's own input).

- [ ] **Step 5: Verify the bridge is installed**

In the browser DevTools console:

```javascript
window.rdvBridge
window.rdvBridge.version
```

Expected:
- `window.rdvBridge` is an object.
- `window.rdvBridge.version` is `1`.

- [ ] **Step 6: Drive a smart-key sequence from the console**

```javascript
window.rdvBridge.input("ls\n");
```
Expected: `ls` runs in the terminal.

```javascript
window.rdvBridge.key("Tab", {});
```
Expected: a tab character is sent (visible if there's a partial command in the terminal).

- [ ] **Step 7: Visit `/m/channel/<id>` and `/m/recording/<id>`**

Pick an existing channel + recording id and confirm each route renders without app chrome. The channel view should look like the existing PWA channel view minus the tab bar; the recording view should play back as in the desktop player.

- [ ] **Step 8: Stop dev**

Stop the dev server.

- [ ] **Step 9: Final commit (if any tweaks were needed)**

If the smoke test surfaced issues that required code edits to `EmbeddedSessionView` / `EmbeddedChannelView` / `EmbeddedRecordingView` / pages, commit them now with a descriptive message.

---

## Self-review checklist (the implementer should run this)

- [ ] All 10 unit tests in `rdv-bridge.test.ts` pass.
- [ ] `EmbeddedSessionView.test.tsx` 3 tests pass.
- [ ] `bun run typecheck` is clean.
- [ ] `bun run lint` is clean.
- [ ] `bun run build` completes without errors.
- [ ] Manual smoke test in Task 10 passed end-to-end.
- [ ] All commits are pushed to a branch named `feat/mobile-embed-routes` and a PR is open.

## Out of scope — explicitly deferred to later plans

- The `MobileViewportSwitch` UA-sniff guard for `RemoteDevMobile/` UA. The `/m/*` routes don't go through that switch (it lives at `/`), so no code change is required for this plan. Verification of the assumption belongs in the Flutter Phase 1 plan.
- Native Flutter app scaffolding, splash, biometric, push notifications. (Plan: `2026-?-?-flutter-app-phase-1-shell.md`)
- Bridge smoke test from the actual native Flutter shell. (Phase 1.5 plan)
- Native session-view chrome (status bar, smart-key strip, native input bar). (Phase 2 plan)
- Pinch-zoom + `setFontSize` wiring through the bridge. (Phase 2 plan, with the native gesture)
- Outbound `onSelectionChange` / `onWantsPaste` / `onActivity` / `onLinkOpen` notifications. The bridge has the helper; the embed views don't emit them yet. They're wired in Phase 2 when the corresponding native chrome appears.
