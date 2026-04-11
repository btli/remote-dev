"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useLiteLLMContext } from "@/contexts/LiteLLMContext";
import type { LiteLLMProvider } from "@/types/litellm";

const PROVIDERS: { value: LiteLLMProvider; label: string }[] = [
  { value: "anthropic", label: "Anthropic" },
  { value: "openai", label: "OpenAI" },
  { value: "azure", label: "Azure OpenAI" },
  { value: "databricks", label: "Databricks" },
  { value: "openrouter", label: "OpenRouter" },
  { value: "custom", label: "Custom" },
];

interface AddModelDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddModelDialog({ open, onOpenChange }: AddModelDialogProps) {
  const { addModel } = useLiteLLMContext();
  const [saving, setSaving] = useState(false);

  const [modelName, setModelName] = useState("");
  const [provider, setProvider] = useState<string>("anthropic");
  const [litellmModel, setLitellmModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [apiBase, setApiBase] = useState("");

  const reset = () => {
    setModelName("");
    setProvider("anthropic");
    setLitellmModel("");
    setApiKey("");
    setApiBase("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!modelName.trim() || !litellmModel.trim()) return;

    setSaving(true);
    try {
      await addModel({
        modelName: modelName.trim(),
        provider,
        litellmModel: litellmModel.trim(),
        apiKey: apiKey.trim() || undefined,
        apiBase: apiBase.trim() || undefined,
      });
      reset();
      onOpenChange(false);
    } catch {
      // Error already toasted by context
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Model</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="modelName">Display Name</Label>
            <Input
              id="modelName"
              placeholder="e.g. claude-opus"
              value={modelName}
              onChange={(e) => setModelName(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="provider">Provider</Label>
            <Select value={provider} onValueChange={setProvider}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROVIDERS.map((p) => (
                  <SelectItem key={p.value} value={p.value}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="litellmModel">LiteLLM Model ID</Label>
            <Input
              id="litellmModel"
              placeholder="e.g. anthropic/claude-opus-4-6"
              value={litellmModel}
              onChange={(e) => setLitellmModel(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="apiKey">API Key</Label>
            <Input
              id="apiKey"
              type="password"
              placeholder="sk-..."
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="apiBase">API Base URL (optional)</Label>
            <Input
              id="apiBase"
              placeholder="https://..."
              value={apiBase}
              onChange={(e) => setApiBase(e.target.value)}
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={saving || !modelName.trim() || !litellmModel.trim()}
            >
              {saving ? "Adding..." : "Add Model"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
