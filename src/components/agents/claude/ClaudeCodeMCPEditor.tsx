"use client";

import { useState } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { TagInput, KeyValueEditor } from "../shared";
import { cn } from "@/lib/utils";
import {
  Plus,
  Trash2,
  ChevronDown,
  ChevronRight,
  Server,
  Settings2,
} from "lucide-react";
import type { ClaudeCodeConfig, ClaudeCodeMCPServer } from "@/types/agent-config";

interface ClaudeCodeMCPEditorProps {
  config: ClaudeCodeConfig;
  onChange: (config: ClaudeCodeConfig) => void;
  disabled?: boolean;
}

/**
 * Single MCP Server editor
 */
function MCPServerEntry({
  name,
  server,
  onChange,
  onRemove,
  onRename,
  disabled,
}: {
  name: string;
  server: ClaudeCodeMCPServer;
  onChange: (server: ClaudeCodeMCPServer) => void;
  onRemove: () => void;
  onRename: (newName: string) => void;
  disabled?: boolean;
}) {
  const [expanded, setExpanded] = useState(true);
  const [editingName, setEditingName] = useState(false);
  const [newName, setNewName] = useState(name);

  const handleNameSubmit = () => {
    if (newName && newName !== name) {
      onRename(newName);
    }
    setEditingName(false);
  };

  return (
    <div className="rounded-lg border border-border bg-muted/20 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 hover:bg-muted/30 transition-colors">
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-2 flex-1"
          disabled={disabled}
        >
          {expanded ? (
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
          )}
          <Server className="w-4 h-4 text-primary" />
          {editingName ? (
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onBlur={handleNameSubmit}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleNameSubmit();
                if (e.key === "Escape") {
                  setNewName(name);
                  setEditingName(false);
                }
              }}
              onClick={(e) => e.stopPropagation()}
              className="h-6 text-sm font-mono w-40"
              autoFocus
            />
          ) : (
            <span
              className="text-sm font-mono cursor-pointer hover:text-primary"
              onClick={(e) => {
                e.stopPropagation();
                if (!disabled) {
                  setEditingName(true);
                }
              }}
            >
              {name}
            </span>
          )}
        </button>

        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => setEditingName(true)}
            disabled={disabled}
            className="h-6 w-6"
          >
            <Settings2 className="w-3.5 h-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onRemove}
            disabled={disabled}
            className="h-6 w-6 text-destructive hover:text-destructive hover:bg-destructive/10"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      {expanded && (
        <div className="px-3 pb-3 pt-1 space-y-4 border-t border-border/50">
          {/* Command */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Command</Label>
            <Input
              value={server.command}
              onChange={(e) => onChange({ ...server, command: e.target.value })}
              placeholder="npx -y @modelcontextprotocol/server-name"
              disabled={disabled}
              className="font-mono text-sm"
            />
          </div>

          {/* Arguments */}
          <TagInput
            label="Arguments"
            description="Command-line arguments for the server"
            value={server.args || []}
            onChange={(args) => onChange({ ...server, args })}
            placeholder="Add argument"
            disabled={disabled}
          />

          {/* Environment Variables */}
          <KeyValueEditor
            label="Environment Variables"
            description="Environment variables to pass to the server"
            value={server.env || {}}
            onChange={(env) => onChange({ ...server, env })}
            keyPlaceholder="Variable"
            valuePlaceholder="Value"
            disabled={disabled}
          />
        </div>
      )}
    </div>
  );
}

/**
 * ClaudeCodeMCPEditor - MCP (Model Context Protocol) server configuration
 *
 * Manages:
 * - Adding/removing MCP servers
 * - Server command and arguments
 * - Per-server environment variables
 */
export function ClaudeCodeMCPEditor({
  config,
  onChange,
  disabled = false,
}: ClaudeCodeMCPEditorProps) {
  const mcpServers = config.mcpServers || {};
  const [newServerName, setNewServerName] = useState("");

  const updateServers = (servers: Record<string, ClaudeCodeMCPServer>) => {
    onChange({
      ...config,
      mcpServers: servers,
    });
  };

  const addServer = () => {
    const name = newServerName.trim() || `server-${Object.keys(mcpServers).length + 1}`;
    if (mcpServers[name]) {
      return; // Name already exists
    }
    updateServers({
      ...mcpServers,
      [name]: { command: "" },
    });
    setNewServerName("");
  };

  const updateServer = (name: string, server: ClaudeCodeMCPServer) => {
    updateServers({
      ...mcpServers,
      [name]: server,
    });
  };

  const removeServer = (name: string) => {
    const { [name]: _removed, ...rest } = mcpServers;
    void _removed; // Intentionally unused - just removing from object
    updateServers(rest);
  };

  const renameServer = (oldName: string, newName: string) => {
    if (oldName === newName || mcpServers[newName]) return;
    const { [oldName]: server, ...rest } = mcpServers;
    updateServers({
      ...rest,
      [newName]: server,
    });
  };

  const serverEntries = Object.entries(mcpServers);

  return (
    <div className="space-y-4">
      <div>
        <h4 className="text-sm font-medium text-foreground">MCP Servers</h4>
        <p className="text-xs text-muted-foreground mt-0.5">
          Model Context Protocol servers extend Claude&apos;s capabilities with
          custom tools and resources
        </p>
      </div>

      {/* Existing Servers */}
      {serverEntries.length > 0 ? (
        <div className="space-y-2">
          {serverEntries.map(([name, server]) => (
            <MCPServerEntry
              key={name}
              name={name}
              server={server}
              onChange={(s) => updateServer(name, s)}
              onRemove={() => removeServer(name)}
              onRename={(newName) => renameServer(name, newName)}
              disabled={disabled}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-border p-6 text-center">
          <Server className="w-8 h-8 mx-auto text-muted-foreground/50 mb-2" />
          <p className="text-sm text-muted-foreground">
            No MCP servers configured
          </p>
          <p className="text-xs text-muted-foreground/70 mt-1">
            Add a server to extend Claude&apos;s capabilities
          </p>
        </div>
      )}

      {/* Add New Server */}
      <div className="flex gap-2">
        <Input
          value={newServerName}
          onChange={(e) => setNewServerName(e.target.value)}
          placeholder="Server name (e.g., filesystem, github)"
          disabled={disabled}
          className="flex-1"
          onKeyDown={(e) => {
            if (e.key === "Enter") addServer();
          }}
        />
        <Button
          type="button"
          variant="outline"
          onClick={addServer}
          disabled={disabled}
        >
          <Plus className="w-4 h-4 mr-2" />
          Add Server
        </Button>
      </div>

      {/* Quick Add Popular Servers */}
      <div className="rounded-lg border border-border p-3">
        <p className="text-xs text-muted-foreground mb-2">Quick Add:</p>
        <div className="flex flex-wrap gap-2">
          {[
            { name: "filesystem", cmd: "npx -y @anthropic/mcp-server-filesystem" },
            { name: "github", cmd: "npx -y @anthropic/mcp-server-github" },
            { name: "brave-search", cmd: "npx -y @anthropic/mcp-server-brave-search" },
            { name: "puppeteer", cmd: "npx -y @anthropic/mcp-server-puppeteer" },
          ].map((preset) => (
            <Button
              key={preset.name}
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                if (!mcpServers[preset.name]) {
                  updateServers({
                    ...mcpServers,
                    [preset.name]: { command: preset.cmd },
                  });
                }
              }}
              disabled={disabled || !!mcpServers[preset.name]}
              className={cn(
                "text-xs",
                mcpServers[preset.name] && "opacity-50"
              )}
            >
              {preset.name}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}
