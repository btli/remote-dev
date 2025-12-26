"use client";

import { useState, useEffect, useCallback } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Loader2,
  Server,
  Plus,
  Trash2,
  AlertCircle,
} from "lucide-react";
import type { MCPServer, MCPTransport, CreateMCPServerInput } from "@/types/agent";

interface ProfileMcpServersTabProps {
  profileId: string;
}

const TRANSPORT_OPTIONS: { value: MCPTransport; label: string }[] = [
  { value: "stdio", label: "Standard I/O" },
  { value: "http", label: "HTTP" },
  { value: "sse", label: "Server-Sent Events" },
];

export function ProfileMcpServersTab({ profileId }: ProfileMcpServersTabProps) {
  const [loading, setLoading] = useState(true);
  const [servers, setServers] = useState<MCPServer[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  // Form state
  const [name, setName] = useState("");
  const [transport, setTransport] = useState<MCPTransport>("stdio");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [autoStart, setAutoStart] = useState(false);
  const [saving, setSaving] = useState(false);

  // Load servers on mount
  useEffect(() => {
    let mounted = true;

    const loadServers = async () => {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(`/api/mcp-servers?profileId=${profileId}`);
        if (!response.ok) {
          throw new Error("Failed to load MCP servers");
        }
        const data = await response.json();
        if (mounted) {
          setServers(data.servers || []);
        }
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err.message : "Failed to load MCP servers");
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    loadServers();

    return () => {
      mounted = false;
    };
  }, [profileId]);

  const handleAddServer = useCallback(async () => {
    if (!name.trim() || !command.trim()) {
      setError("Name and command are required");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const input: CreateMCPServerInput = {
        name: name.trim(),
        transport,
        command: command.trim(),
        args: args
          .split("\n")
          .map((a) => a.trim())
          .filter((a) => a),
        enabled,
        autoStart,
      };

      const response = await fetch("/api/mcp-servers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...input, profileId }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to add MCP server");
      }

      const newServer = await response.json();
      setServers((prev) => [...prev, newServer]);

      // Reset form
      setName("");
      setTransport("stdio");
      setCommand("");
      setArgs("");
      setEnabled(true);
      setAutoStart(false);
      setShowForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add MCP server");
    } finally {
      setSaving(false);
    }
  }, [profileId, name, transport, command, args, enabled, autoStart]);

  const handleDeleteServer = useCallback(async (serverId: string) => {
    try {
      const response = await fetch(`/api/mcp-servers/${serverId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error("Failed to delete MCP server");
      }

      setServers((prev) => prev.filter((s) => s.id !== serverId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete MCP server");
    }
  }, []);

  const handleToggleEnabled = useCallback(async (serverId: string, newEnabled: boolean) => {
    try {
      const response = await fetch(`/api/mcp-servers/${serverId}/toggle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: newEnabled }),
      });

      if (!response.ok) {
        throw new Error("Failed to toggle MCP server");
      }

      setServers((prev) =>
        prev.map((s) => (s.id === serverId ? { ...s, enabled: newEnabled } : s))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to toggle MCP server");
    }
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-violet-400" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between pb-2 border-b border-white/5">
        <div className="flex items-center gap-2 text-sm text-slate-400">
          <Server className="w-4 h-4" />
          <span>Configure MCP servers for this profile</span>
        </div>
        <Button
          size="sm"
          onClick={() => setShowForm(true)}
          className="bg-violet-600 hover:bg-violet-700 text-white"
        >
          <Plus className="w-4 h-4 mr-1" />
          Add Server
        </Button>
      </div>

      {/* Server List */}
      {servers.length === 0 && !showForm ? (
        <div className="text-center py-8 text-slate-400">
          <Server className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p>No MCP servers configured</p>
          <p className="text-sm mt-1">
            Add an MCP server to extend agent capabilities
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {servers.map((server) => (
            <div
              key={server.id}
              className="flex items-center justify-between p-3 rounded-lg bg-slate-800/30 border border-white/5"
            >
              <div className="flex items-center gap-3">
                <div
                  className={`w-2 h-2 rounded-full ${
                    server.enabled ? "bg-emerald-400" : "bg-slate-500"
                  }`}
                />
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-white">{server.name}</span>
                    <Badge
                      variant="outline"
                      className="text-[10px] bg-slate-800/50 text-slate-400 border-slate-700"
                    >
                      {server.transport}
                    </Badge>
                  </div>
                  <p className="text-xs text-slate-500 font-mono truncate max-w-[250px]">
                    {server.command}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={server.enabled}
                  onCheckedChange={(checked) => handleToggleEnabled(server.id, checked)}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => handleDeleteServer(server.id)}
                  className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add Server Form */}
      {showForm && (
        <div className="p-4 rounded-lg bg-slate-800/30 border border-white/5 space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="font-medium text-white">Add MCP Server</h4>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowForm(false)}
              className="text-slate-400 hover:text-white"
            >
              Cancel
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-slate-300">Name</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="my-server"
                className="bg-slate-800 border-white/10 text-white placeholder:text-slate-500"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-slate-300">Transport</Label>
              <Select value={transport} onValueChange={(v) => setTransport(v as MCPTransport)}>
                <SelectTrigger className="bg-slate-800 border-white/10 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-slate-800 border-white/10">
                  {TRANSPORT_OPTIONS.map((option) => (
                    <SelectItem
                      key={option.value}
                      value={option.value}
                      className="text-white focus:bg-violet-500/20"
                    >
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-slate-300">Command</Label>
            <Input
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder="npx -y @modelcontextprotocol/server-filesystem"
              className="bg-slate-800 border-white/10 text-white placeholder:text-slate-500 font-mono text-sm"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-slate-300">Arguments (one per line)</Label>
            <textarea
              value={args}
              onChange={(e) => setArgs(e.target.value)}
              placeholder="/path/to/allowed/directory"
              rows={2}
              className="w-full bg-slate-800 border border-white/10 text-white placeholder:text-slate-500 font-mono text-sm rounded-md px-3 py-2"
            />
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Switch checked={enabled} onCheckedChange={setEnabled} />
              <Label className="text-slate-300">Enabled</Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={autoStart} onCheckedChange={setAutoStart} />
              <Label className="text-slate-300">Auto-start</Label>
            </div>
          </div>

          <div className="flex justify-end">
            <Button
              onClick={handleAddServer}
              disabled={saving}
              className="bg-violet-600 hover:bg-violet-700 text-white"
            >
              {saving ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Adding...
                </>
              ) : (
                <>
                  <Plus className="w-4 h-4 mr-2" />
                  Add Server
                </>
              )}
            </Button>
          </div>
        </div>
      )}

      {/* Error message */}
      {error && (
        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400 flex items-center gap-2">
          <AlertCircle className="w-4 h-4" />
          {error}
        </div>
      )}
    </div>
  );
}
