"use client";

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Loader2, Brain } from "lucide-react";
import { useOrchestratorContext } from "@/contexts/OrchestratorContext";
import { useSessionContext } from "@/contexts/SessionContext";

interface SubOrchestratorConfigModalProps {
  open: boolean;
  onClose: () => void;
  folderId: string;
  folderName: string;
}

/**
 * SubOrchestratorConfigModal - Configure sub-orchestrator for a folder
 *
 * Allows creating a folder-scoped orchestrator with:
 * - Custom monitoring interval
 * - Stall threshold
 * - Custom instructions
 * - Auto-intervention toggle
 */
export function SubOrchestratorConfigModal({
  open,
  onClose,
  folderId,
  folderName,
}: SubOrchestratorConfigModalProps) {
  const { createOrchestrator, getOrchestratorForFolder } = useOrchestratorContext();
  const { sessions } = useSessionContext();

  const [monitoringInterval, setMonitoringInterval] = useState(30);
  const [stallThreshold, setStallThreshold] = useState(300);
  const [customInstructions, setCustomInstructions] = useState("");
  const [autoIntervention, setAutoIntervention] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Check if orchestrator already exists for this folder
  const existingOrchestrator = getOrchestratorForFolder(folderId);

  // Get sessions in this folder to determine orchestrator session
  const folderSessions = sessions.filter((s) => s.folderId === folderId && s.status === "active");
  const orchestratorSessionId = folderSessions[0]?.id;

  useEffect(() => {
    if (open) {
      // Reset form
      setMonitoringInterval(30);
      setStallThreshold(300);
      setCustomInstructions("");
      setAutoIntervention(false);
      setError(null);
    }
  }, [open]);

  const handleCreate = async () => {
    if (!orchestratorSessionId) {
      setError("No active session in this folder. Create a session first.");
      return;
    }

    setIsCreating(true);
    setError(null);

    try {
      await createOrchestrator({
        sessionId: orchestratorSessionId,
        type: "sub_orchestrator",
        folderId,
        customInstructions: customInstructions.trim() || undefined,
        monitoringInterval,
        stallThreshold,
        autoIntervention,
      });

      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create orchestrator");
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="sm:max-w-[500px] bg-popover/95 backdrop-blur-xl border-border">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Brain className="h-5 w-5 text-primary" />
            <DialogTitle>
              {existingOrchestrator ? "Sub-Orchestrator Config" : "Create Sub-Orchestrator"}
            </DialogTitle>
          </div>
          <DialogDescription>
            {existingOrchestrator
              ? "This folder already has a sub-orchestrator configured."
              : `Create an orchestrator to monitor sessions in "${folderName}"`}
          </DialogDescription>
        </DialogHeader>

        {existingOrchestrator ? (
          <div className="space-y-4 py-4">
            <div className="rounded-lg border border-border bg-muted/50 p-4">
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Status:</span>
                  <span className="font-medium">{existingOrchestrator.status}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Monitoring Interval:</span>
                  <span className="font-medium">{existingOrchestrator.monitoringInterval}s</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Stall Threshold:</span>
                  <span className="font-medium">{existingOrchestrator.stallThreshold}s</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Auto-Intervention:</span>
                  <span className="font-medium">
                    {existingOrchestrator.autoIntervention ? "Enabled" : "Disabled"}
                  </span>
                </div>
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              To modify settings, use the orchestrator management panel.
            </p>
          </div>
        ) : (
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="monitoringInterval">
                Monitoring Interval (seconds)
              </Label>
              <Input
                id="monitoringInterval"
                type="number"
                min={10}
                max={300}
                value={monitoringInterval}
                onChange={(e) => setMonitoringInterval(parseInt(e.target.value) || 30)}
                placeholder="30"
              />
              <p className="text-xs text-muted-foreground">
                How often to check for stalled sessions (10-300 seconds)
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="stallThreshold">Stall Threshold (seconds)</Label>
              <Input
                id="stallThreshold"
                type="number"
                min={60}
                max={3600}
                value={stallThreshold}
                onChange={(e) => setStallThreshold(parseInt(e.target.value) || 300)}
                placeholder="300"
              />
              <p className="text-xs text-muted-foreground">
                Time without terminal activity before flagging as stalled (60-3600 seconds)
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="customInstructions">Custom Instructions (optional)</Label>
              <Textarea
                id="customInstructions"
                rows={3}
                value={customInstructions}
                onChange={(e) => setCustomInstructions(e.target.value)}
                placeholder="e.g., Focus on development sessions, ignore CI/CD runs..."
              />
              <p className="text-xs text-muted-foreground">
                Special instructions for this orchestrator
              </p>
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="autoIntervention">Auto-Intervention</Label>
                <p className="text-xs text-muted-foreground">
                  Automatically send recovery commands to stalled sessions
                </p>
              </div>
              <Switch
                id="autoIntervention"
                checked={autoIntervention}
                onCheckedChange={setAutoIntervention}
              />
            </div>

            {!orchestratorSessionId && (
              <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/10 p-3 text-sm text-yellow-500">
                No active sessions in this folder. Create a session first to host the orchestrator.
              </div>
            )}

            {error && (
              <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-500">
                {error}
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isCreating}>
            {existingOrchestrator ? "Close" : "Cancel"}
          </Button>
          {!existingOrchestrator && (
            <Button onClick={handleCreate} disabled={isCreating || !orchestratorSessionId}>
              {isCreating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create Orchestrator
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
