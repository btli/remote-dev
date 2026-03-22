"use client";

import { useState, useEffect, useCallback } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Smartphone, Copy, Check, Plus, Trash2, RefreshCw, Key } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { cn } from "@/lib/utils";

interface ApiKeyInfo {
  id: string;
  name: string;
  keyPrefix: string;
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
}

export function MobileSetupPanel() {
  const [keys, setKeys] = useState<ApiKeyInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newKeyName, setNewKeyName] = useState("Mobile App");
  const [showCreateForm, setShowCreateForm] = useState(false);

  // Newly created key (shown once for QR generation)
  const [newKey, setNewKey] = useState<{ key: string; name: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [deleteKeyId, setDeleteKeyId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const serverUrl = typeof window !== "undefined" ? window.location.origin : "";
  const terminalPort = typeof window !== "undefined"
    ? (process.env.NEXT_PUBLIC_TERMINAL_PORT || "6002")
    : "6002";

  const fetchKeys = useCallback(async () => {
    try {
      const res = await fetch("/api/keys");
      if (!res.ok) return;
      const data = await res.json();
      setKeys(data.keys ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchKeys();
  }, [fetchKeys]);

  const handleCreate = async () => {
    if (!newKeyName.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newKeyName.trim() }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to create key");
      }
      const data = await res.json();
      setNewKey({ key: data.key, name: data.name });
      setShowCreateForm(false);
      setNewKeyName("Mobile App");
      await fetchKeys();
    } catch (error) {
      console.error("Failed to create API key:", error);
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string) => {
    setDeleting(true);
    try {
      await fetch(`/api/keys/${id}`, { method: "DELETE" });
      await fetchKeys();
      setDeleteKeyId(null);
    } finally {
      setDeleting(false);
    }
  };

  const handleCopy = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const qrPayload = newKey
    ? JSON.stringify({
        url: serverUrl,
        port: terminalPort,
        apiKey: newKey.key,
      })
    : null;

  // ── New key generated → show QR code ────────────────────────────────
  if (newKey && qrPayload) {
    return (
      <div className="space-y-4">
        <div className="text-center space-y-3">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 text-primary text-sm font-medium">
            <Check className="w-4 h-4" />
            Key created — scan with the mobile app
          </div>

          <div className="flex justify-center">
            <div className="p-4 bg-white rounded-xl">
              <QRCodeSVG
                value={qrPayload}
                size={200}
                level="M"
                includeMargin={false}
              />
            </div>
          </div>

          <p className="text-xs text-muted-foreground max-w-[280px] mx-auto">
            Open Remote Dev mobile app → Add Server → Scan QR Code
          </p>
        </div>

        <div className="space-y-2">
          <Label className="text-foreground text-xs">API Key (shown once)</Label>
          <div className="flex gap-2">
            <Input
              value={newKey.key}
              readOnly
              className="font-mono text-xs bg-input border-border text-foreground"
            />
            <Button
              size="sm"
              variant="outline"
              onClick={() => handleCopy(newKey.key)}
              className="shrink-0"
            >
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            </Button>
          </div>
        </div>

        <Button
          variant="outline"
          className="w-full"
          onClick={() => setNewKey(null)}
        >
          Done
        </Button>
      </div>
    );
  }

  // ── Main view: key list + create form ───────────────────────────────
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <p className="text-xs text-muted-foreground">
          Generate an API key and scan the QR code with the mobile app to connect.
        </p>
      </div>

      {/* Existing keys */}
      {loading ? (
        <div className="flex items-center justify-center py-6">
          <RefreshCw className="w-4 h-4 animate-spin text-muted-foreground" />
        </div>
      ) : keys.length > 0 ? (
        <div className="space-y-1.5">
          {keys.map((key) => (
            <div
              key={key.id}
              className="flex items-center gap-3 px-3 py-2 rounded-lg bg-muted/50 border border-border"
            >
              <Key className="w-4 h-4 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-foreground truncate">{key.name}</p>
                <p className="text-xs text-muted-foreground">
                  {key.keyPrefix}... · {new Date(key.createdAt).toLocaleDateString()}
                  {key.expiresAt && (
                    <span
                      className={cn(
                        new Date(key.expiresAt) < new Date() && "text-destructive"
                      )}
                    >
                      {" "}· expires {new Date(key.expiresAt).toLocaleDateString()}
                    </span>
                  )}
                </p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="shrink-0 text-muted-foreground hover:text-destructive"
                onClick={() => setDeleteKeyId(key.id)}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center py-6 text-center">
          <Smartphone className="w-8 h-8 text-muted-foreground/40 mb-2" />
          <p className="text-sm text-muted-foreground">No API keys yet</p>
          <p className="text-xs text-muted-foreground mt-1">
            Create one to connect the mobile app
          </p>
        </div>
      )}

      {/* Create form */}
      {showCreateForm ? (
        <div className="space-y-2 p-3 rounded-lg bg-muted/30 border border-border">
          <Label className="text-foreground text-sm">Key name</Label>
          <div className="flex gap-2">
            <Input
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              placeholder="Mobile App"
              className="bg-input border-border text-foreground"
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              autoFocus
            />
            <Button
              size="sm"
              onClick={handleCreate}
              disabled={creating || !newKeyName.trim()}
            >
              {creating ? <RefreshCw className="w-4 h-4 animate-spin" /> : "Create"}
            </Button>
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="w-full text-xs"
            onClick={() => setShowCreateForm(false)}
          >
            Cancel
          </Button>
        </div>
      ) : (
        <Button
          variant="outline"
          className="w-full"
          onClick={() => setShowCreateForm(true)}
        >
          <Plus className="w-4 h-4 mr-2" />
          New API Key
        </Button>
      )}

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteKeyId} onOpenChange={() => setDeleteKeyId(null)}>
        <AlertDialogContent className="bg-popover border-border">
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke API Key</AlertDialogTitle>
            <AlertDialogDescription>
              The mobile app using this key will be disconnected immediately. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteKeyId && handleDelete(deleteKeyId)}
              disabled={deleting}
            >
              Revoke
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
