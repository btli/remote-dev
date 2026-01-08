"use client";

import { useState, useEffect } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AlertTriangle, Loader2, Terminal } from "lucide-react";

interface CommandInjectionDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (command: string, reason: string) => Promise<void>;
  sessionName: string;
  initialCommand?: string;
  isDangerous?: boolean;
}

/**
 * CommandInjectionDialog - Confirmation dialog for command injection
 *
 * Shows warning and requires reason before injecting commands into sessions.
 * Used by orchestrators to intervene in stalled sessions.
 */
export function CommandInjectionDialog({
  open,
  onClose,
  onConfirm,
  sessionName,
  initialCommand = "",
  isDangerous = false,
}: CommandInjectionDialogProps) {
  const [command, setCommand] = useState(initialCommand);
  const [reason, setReason] = useState("");
  const [isExecuting, setIsExecuting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset form when dialog opens or initialCommand changes
  useEffect(() => {
    if (open) {
      setCommand(initialCommand);
      setReason("");
      setError(null);
    }
  }, [open, initialCommand]);

  // Clear error when user modifies input (allows retry after error)
  useEffect(() => {
    if (error) {
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [command, reason]);

  const handleConfirm = async () => {
    if (!command.trim()) {
      setError("Command cannot be empty");
      return;
    }

    setIsExecuting(true);
    setError(null);

    try {
      await onConfirm(command.trim(), reason.trim());
      // Reset form and close on success
      setCommand(initialCommand);
      setReason("");
      setError(null);
      onClose();
    } catch (err) {
      // Show error but keep form state so user can retry
      setError(err instanceof Error ? err.message : "Failed to inject command");
    } finally {
      setIsExecuting(false);
    }
  };

  const handleCancel = () => {
    setCommand(initialCommand);
    setReason("");
    setError(null);
    onClose();
  };

  return (
    <AlertDialog open={open} onOpenChange={(isOpen) => !isOpen && handleCancel()}>
      <AlertDialogContent className="sm:max-w-[500px]">
        <AlertDialogHeader>
          <div className="flex items-center gap-2">
            {isDangerous && <AlertTriangle className="h-5 w-5 text-red-500" />}
            <AlertDialogTitle>
              {isDangerous ? "Dangerous Command Warning" : "Inject Command"}
            </AlertDialogTitle>
          </div>
          <AlertDialogDescription>
            You are about to inject a command into session: <strong>{sessionName}</strong>
            {isDangerous && (
              <span className="block mt-2 text-red-500">
                ⚠️ This command has been flagged as potentially dangerous and may disrupt the
                session or cause data loss.
              </span>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="command">Command</Label>
            <div className="relative">
              <Terminal className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                id="command"
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                placeholder="e.g., Ctrl-C, ls, npm test"
                className="pl-9 font-mono"
                disabled={isExecuting}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Enter the command or control character to send
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="reason">Reason (optional)</Label>
            <Textarea
              id="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g., Interrupting stalled process..."
              rows={2}
              disabled={isExecuting}
            />
            <p className="text-xs text-muted-foreground">
              Explain why this intervention is needed (will be logged)
            </p>
          </div>

          {isDangerous && (
            <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-500">
              <p className="font-medium">Safety Warning</p>
              <p className="mt-1">
                This command may cause unexpected behavior. Make sure you understand the impact
                before proceeding.
              </p>
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-500">
              {error}
            </div>
          )}
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel onClick={handleCancel} disabled={isExecuting}>
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
            disabled={isExecuting || !command.trim()}
            className={isDangerous ? "bg-red-500 hover:bg-red-600" : ""}
          >
            {isExecuting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isDangerous ? "Execute Anyway" : "Execute Command"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
