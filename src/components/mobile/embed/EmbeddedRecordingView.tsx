"use client";

/**
 * EmbeddedRecordingView — recording playback only, no app chrome.
 *
 * Wraps the existing RecordingPlayer. window.rdvBridge.back() is the
 * only meaningful native-driven action; everything else is stubbed.
 *
 * Note on prop shape vs. plan: the plan's snippet assumed
 * `RecordingPlayer` accepts a `recordingId: string`, but the actual
 * component takes a parsed recording object. Task 8's page hands us a
 * `recordingId: string` (from the URL), so this wrapper owns the fetch.
 * We hit the same `/api/recordings/:id?parsed=true` endpoint
 * RecordingContext.getRecording uses, so we don't depend on a
 * RecordingProvider being mounted under the embed route.
 */

import { useEffect, useState } from "react";

import { RecordingPlayer } from "@/components/terminal/RecordingPlayer";
import { installRdvBridge, type RdvBridgeAdapter } from "@/lib/rdv-bridge";
import type { ParsedRecording } from "@/types/recording";

const noop = () => {};

export interface EmbeddedRecordingViewProps {
  recordingId: string;
}

export function EmbeddedRecordingView({
  recordingId,
}: EmbeddedRecordingViewProps) {
  const [recording, setRecording] = useState<ParsedRecording | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const adapter: RdvBridgeAdapter = {
      input: noop,
      key: noop,
      paste: noop,
      setFontSize: noop,
      scrollToBottom: noop,
      // Recording playback has no in-WebView "back" action — return
      // false so the native shell pops the route itself.
      back: () => false,
    };
    return installRdvBridge(adapter);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setRecording(null);

    void (async () => {
      try {
        const response = await fetch(
          `/api/recordings/${encodeURIComponent(recordingId)}?parsed=true`
        );
        if (cancelled) return;
        if (!response.ok) {
          setError(
            response.status === 404
              ? "Recording not found"
              : "Failed to load recording"
          );
          return;
        }
        const parsed = (await response.json()) as ParsedRecording;
        if (cancelled) return;
        setRecording(parsed);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load recording");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [recordingId]);

  return (
    <div className="relative h-full w-full bg-[#1a1b26]">
      {loading ? (
        <div
          data-testid="embedded-recording-loading"
          className="flex h-full w-full items-center justify-center text-sm text-muted-foreground"
        >
          Loading recording...
        </div>
      ) : error ? (
        <div
          data-testid="embedded-recording-error"
          className="flex h-full w-full items-center justify-center px-6 text-center text-sm text-destructive"
        >
          {error}
        </div>
      ) : recording ? (
        <RecordingPlayer recording={recording} />
      ) : null}
    </div>
  );
}
