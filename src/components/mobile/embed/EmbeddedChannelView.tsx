"use client";

/**
 * EmbeddedChannelView — channel list / view / thread, no app chrome.
 *
 * Reuses the existing MobileChannelView. On mount we install a minimal
 * window.rdvBridge whose only meaningful method is `back`, which closes
 * an open thread first — equivalent to the user tapping the native back
 * button while a thread is on top. Otherwise the native shell pops the
 * route based on its own back-stack state.
 *
 * Other rdvBridge methods (input, key, paste, setFontSize,
 * scrollToBottom) are stubbed since the channel surface doesn't drive
 * a terminal.
 *
 * Note on prop shape vs. plan: the plan's snippet kept thread state in
 * local `useState`, but the actual MobileThreadTakeover takes `open` +
 * `onClose` and reads the thread id from ChannelContext (`openThreadId`,
 * `closeThread`). MobileChannelView.handleReplyClick already calls
 * `openThread(messageId)` on context. We mirror ChannelsTab and consume
 * the context directly so the takeover renders correctly.
 */

import { useEffect } from "react";

import { MobileChannelView } from "@/components/mobile/channels/MobileChannelView";
import { MobileThreadTakeover } from "@/components/mobile/channels/MobileThreadTakeover";
import { useChannelContextOptional } from "@/contexts/ChannelContext";
import { installRdvBridge, type RdvBridgeAdapter } from "@/lib/rdv-bridge";

const noop = () => {};

export function EmbeddedChannelView() {
  const channels = useChannelContextOptional();
  const openThreadId = channels?.openThreadId ?? null;
  const closeThread = channels?.closeThread;

  useEffect(() => {
    const adapter: RdvBridgeAdapter = {
      input: noop,
      key: noop,
      paste: noop,
      setFontSize: noop,
      setFontScale: (scale) => {
        // Channel view consumes --rdv-font-scale to scale markdown text
        // in CSS. Applying it on <html> means the rule is in scope for
        // any descendant — including the thread takeover.
        if (typeof document !== "undefined") {
          document.documentElement.style.setProperty(
            "--rdv-font-scale",
            String(scale),
          );
        }
      },
      // No terminal hosted here — accept the call as a no-op.
      setCursorBlink: noop,
      scrollToBottom: noop,
      back: () => {
        // Closing an open thread takes priority over leaving the route.
        // Return true so the native shell knows we consumed the gesture
        // and skips its own Navigator.maybePop() — otherwise the back
        // press would close the thread AND pop the route.
        if (openThreadId && closeThread) {
          closeThread();
          return true;
        }
        // Otherwise the native shell pops the route itself based on
        // its own back-stack state.
        return false;
      },
    };
    return installRdvBridge(adapter);
  }, [openThreadId, closeThread]);

  // Defensive: if no ChannelProvider is mounted (e.g. desktop browser
  // smoke test outside the proper route), render a calm empty state
  // instead of crashing inside MobileChannelView.
  if (!channels || !closeThread) {
    return (
      <div
        data-testid="embedded-channel-no-provider"
        className="flex h-full w-full items-center justify-center bg-[#1a1b26] px-6 text-center text-sm text-muted-foreground"
      >
        Channels unavailable.
      </div>
    );
  }

  return (
    <div className="relative h-full w-full bg-[#1a1b26]">
      {/* MobileChannelView already drives `openThread` on the context when
          the user taps a reply chip, so the local onOpenThread callback is
          a no-op — the takeover renders off `openThreadId`. */}
      <MobileChannelView onBack={noop} onOpenThread={noop} />
      <MobileThreadTakeover open={!!openThreadId} onClose={closeThread} />
    </div>
  );
}
