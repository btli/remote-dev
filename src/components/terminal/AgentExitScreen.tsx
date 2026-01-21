"use client";

/**
 * AgentExitScreen - Overlay shown when an agent session exits
 *
 * Displays exit information and provides options to:
 * - Restart the agent (creates new tmux session with same config)
 * - Close the session (delete from sidebar)
 */

import { RefreshCw, X, Terminal, Clock, AlertCircle, CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface AgentExitScreenProps {
  sessionId: string;
  sessionName: string;
  exitCode: number | null;
  exitedAt: string;
  restartCount: number;
  onRestart: () => void;
  onClose: () => void;
  isRestarting?: boolean;
}

export function AgentExitScreen({
  sessionName,
  exitCode,
  exitedAt,
  restartCount,
  onRestart,
  onClose,
  isRestarting = false,
}: AgentExitScreenProps) {
  const exitedTime = new Date(exitedAt);
  const formattedTime = exitedTime.toLocaleTimeString();
  const isSuccess = exitCode === 0;

  return (
    <div className="absolute inset-0 flex items-center justify-center bg-black/80 backdrop-blur-sm z-10">
      <div className="bg-card border border-border rounded-lg p-6 max-w-md w-full mx-4 shadow-2xl">
        {/* Header */}
        <div className="flex items-center gap-3 mb-4">
          <div
            className={cn(
              "p-2 rounded-full",
              isSuccess ? "bg-green-500/20" : "bg-yellow-500/20"
            )}
          >
            {isSuccess ? (
              <CheckCircle className="w-6 h-6 text-green-500" />
            ) : (
              <AlertCircle className="w-6 h-6 text-yellow-500" />
            )}
          </div>
          <div>
            <h2 className="text-lg font-semibold text-foreground">
              Agent Session Ended
            </h2>
            <p className="text-sm text-muted-foreground">{sessionName}</p>
          </div>
        </div>

        {/* Exit Details */}
        <div className="space-y-3 mb-6">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground flex items-center gap-2">
              <Terminal className="w-4 h-4" />
              Exit Code
            </span>
            <span
              className={cn(
                "font-mono px-2 py-0.5 rounded",
                isSuccess
                  ? "bg-green-500/20 text-green-400"
                  : "bg-yellow-500/20 text-yellow-400"
              )}
            >
              {exitCode ?? "unknown"}
            </span>
          </div>

          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground flex items-center gap-2">
              <Clock className="w-4 h-4" />
              Exited At
            </span>
            <span className="text-foreground">{formattedTime}</span>
          </div>

          {restartCount > 0 && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground flex items-center gap-2">
                <RefreshCw className="w-4 h-4" />
                Restart Count
              </span>
              <span className="text-foreground">{restartCount}</span>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          <Button
            variant="default"
            className="flex-1"
            onClick={onRestart}
            disabled={isRestarting}
          >
            {isRestarting ? (
              <>
                <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                Restarting...
              </>
            ) : (
              <>
                <RefreshCw className="w-4 h-4 mr-2" />
                Restart Agent
              </>
            )}
          </Button>

          <Button
            variant="outline"
            className="flex-1"
            onClick={onClose}
            disabled={isRestarting}
          >
            <X className="w-4 h-4 mr-2" />
            Close Session
          </Button>
        </div>

        {/* Help Text */}
        <p className="text-xs text-muted-foreground mt-4 text-center">
          Restarting will create a new agent session in the same directory.
        </p>
      </div>
    </div>
  );
}
