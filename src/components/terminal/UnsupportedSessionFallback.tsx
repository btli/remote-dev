"use client";

/**
 * UnsupportedSessionFallback — shown when a session's `terminalType` has no
 * registered client plugin in {@link TerminalTypeClientRegistry}.
 *
 * This can happen if:
 *   - A newer server persisted a session type this build doesn't know about
 *   - A custom plugin was unregistered between session creation and render
 *
 * Session data is preserved on disk; the user can close the tab or upgrade
 * to a build that knows the type.
 */

import { useState } from "react";
import { AlertTriangle, Clipboard, ClipboardCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { TerminalSession } from "@/types/session";

interface UnsupportedSessionFallbackProps {
  session: TerminalSession;
  onCloseSession: () => void;
}

export function UnsupportedSessionFallback({
  session,
  onCloseSession,
}: UnsupportedSessionFallbackProps) {
  const [copied, setCopied] = useState(false);

  const handleCopyDiagnostics = async () => {
    const diagnostics = {
      sessionId: session.id,
      terminalType: session.terminalType,
      typeMetadata: session.typeMetadata ?? null,
    };
    try {
      await navigator.clipboard.writeText(JSON.stringify(diagnostics, null, 2));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy diagnostics:", err);
    }
  };

  return (
    <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm z-10">
      <div className="bg-card border border-border rounded-lg p-6 max-w-lg w-full mx-4 shadow-2xl">
        {/* Header */}
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-full bg-yellow-500/20">
            <AlertTriangle className="w-6 h-6 text-yellow-500" />
          </div>
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-foreground truncate">
              Unsupported session type: {session.terminalType}
            </h2>
            <p className="text-sm text-muted-foreground truncate">
              {session.name}
            </p>
          </div>
        </div>

        {/* Body */}
        <div className="mb-6 text-sm text-muted-foreground">
          <p>
            This session type isn&apos;t registered in the current build. The
            session data is preserved — try upgrading or closing this tab.
          </p>
        </div>

        {/* Diagnostics block */}
        <div className="mb-6 rounded-md border border-border bg-muted/40 p-3 text-xs font-mono text-muted-foreground">
          <div>
            <span className="text-foreground/70">sessionId:</span> {session.id}
          </div>
          <div>
            <span className="text-foreground/70">terminalType:</span>{" "}
            {session.terminalType}
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2 justify-end">
          <Button
            variant="outline"
            onClick={handleCopyDiagnostics}
            className="gap-2"
          >
            {copied ? (
              <ClipboardCheck className="w-4 h-4" />
            ) : (
              <Clipboard className="w-4 h-4" />
            )}
            {copied ? "Copied" : "Copy diagnostics"}
          </Button>
          <Button
            variant="destructive"
            onClick={onCloseSession}
            className="gap-2"
          >
            <X className="w-4 h-4" />
            Close session
          </Button>
        </div>
      </div>
    </div>
  );
}
