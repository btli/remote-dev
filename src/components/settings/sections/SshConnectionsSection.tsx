"use client";

/**
 * SshConnectionsSection — Settings panel for managing saved SSH connections.
 *
 * Two-phase view (list ↔ form), mirroring ProfilesSection. The form supports
 * the four auth methods documented in the design:
 *   - key: paste / upload / generate (ed25519)
 *   - agent: SSH agent forwarding (`-A`)
 *   - password: encrypted at rest, requires sshpass
 *   - system: leans on the user's `~/.ssh/config`
 *
 * Per-connection "Test Connection" button hits the `/test` endpoint and
 * surfaces stderr inline so the user can debug auth/host issues without
 * opening a session.
 */

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Plus,
  Server,
  Loader2,
  ChevronLeft,
  Trash2,
  Copy,
  Check,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import {
  SshConnectionProvider,
  useSshConnections,
  type CreateSshConnectionPayload,
  type SshAuthType,
  type SshConnectionDTO,
  type SshKnownHostsPolicy,
} from "@/contexts/SshConnectionContext";
import { invalidateSshConnections } from "@/components/session/NewSshSubmenu";

export function SshConnectionsSection() {
  return (
    <SshConnectionProvider autoLoad>
      <SshConnectionsSectionInner />
    </SshConnectionProvider>
  );
}

function SshConnectionsSectionInner() {
  const { connections, loading, error, refresh, remove } = useSshConnections();
  const [editing, setEditing] = useState<SshConnectionDTO | "new" | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<SshConnectionDTO | null>(
    null
  );
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    if (!deleteConfirm) return;
    setDeleting(true);
    try {
      await remove(deleteConfirm.id);
      invalidateSshConnections();
      setDeleteConfirm(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setDeleting(false);
    }
  };

  if (editing) {
    return (
      <div className="space-y-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setEditing(null)}
          className="text-muted-foreground"
        >
          <ChevronLeft className="w-4 h-4 mr-1" /> Back to connections
        </Button>
        <SshConnectionForm
          existing={editing === "new" ? null : editing}
          onDone={() => {
            setEditing(null);
            invalidateSshConnections();
            void refresh();
          }}
        />
      </div>
    );
  }

  return (
    <>
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Save SSH targets for the SSH terminal type. Connections persist host,
          port, user, auth method, and per-connection known_hosts.
        </p>
        <Button size="sm" onClick={() => setEditing("new")}>
          <Plus className="w-4 h-4 mr-1" /> New connection
        </Button>
      </div>

      {error && (
        <div className="flex items-start gap-2 p-3 rounded-md border border-destructive/40 bg-destructive/10 text-destructive text-sm">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading && connections.length === 0 ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : connections.length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No SSH connections yet. Click <span className="font-medium">New connection</span> to add one.
        </div>
      ) : (
        <ul className="space-y-2">
          {connections.map((c) => (
            <li
              key={c.id}
              className="flex items-center justify-between gap-3 p-3 rounded-md border border-border bg-card/50"
            >
              <button
                onClick={() => setEditing(c)}
                className="flex-1 text-left flex items-center gap-3 min-w-0"
              >
                <Server className="w-4 h-4 text-primary shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-foreground truncate">{c.name}</div>
                  <div className="text-xs text-muted-foreground truncate">
                    {c.username}@{c.host}:{c.port} · {authBadgeLabel(c.authType)}
                    {c.projectId ? " · pinned to project" : ""}
                  </div>
                </div>
              </button>
              <TestButton id={c.id} />
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setDeleteConfirm(c)}
                className="text-muted-foreground hover:text-destructive"
                aria-label="Delete connection"
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>

    <AlertDialog
      open={!!deleteConfirm}
      onOpenChange={(open) => {
        if (!open) setDeleteConfirm(null);
      }}
    >
      <AlertDialogContent className="bg-popover/95 backdrop-blur-xl border-border">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-foreground">
            Delete SSH Connection
          </AlertDialogTitle>
          <AlertDialogDescription className="text-muted-foreground">
            Are you sure you want to delete{" "}
            <span className="text-foreground font-medium">
              {deleteConfirm?.name}
            </span>
            ? Stored keys and known_hosts for this connection will be removed.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel
            disabled={deleting}
            className="bg-transparent border-border text-muted-foreground hover:bg-accent"
          >
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDelete}
            disabled={deleting}
            className="bg-red-600 hover:bg-red-700 text-white"
          >
            {deleting ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Deleting...
              </>
            ) : (
              "Delete"
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}

function authBadgeLabel(t: SshAuthType): string {
  switch (t) {
    case "key": return "key";
    case "agent": return "agent fwd";
    case "password": return "password";
    case "system": return "system ~/.ssh";
  }
}

// ============================================================================
// Test connection button
// ============================================================================

function TestButton({ id }: { id: string }) {
  const { test } = useSshConnections();
  const [state, setState] = useState<"idle" | "running" | "ok" | "fail">("idle");
  const [stderr, setStderr] = useState<string>("");

  const onClick = async () => {
    setState("running");
    setStderr("");
    try {
      const result = await test(id);
      if (result.ok) {
        setState("ok");
      } else {
        setState("fail");
        setStderr(result.stderr || `exit code ${result.exitCode}`);
      }
    } catch (err) {
      setState("fail");
      setStderr(err instanceof Error ? err.message : "Test failed");
    }
  };

  return (
    <div className="flex items-center gap-1">
      <Button
        variant="ghost"
        size="sm"
        onClick={onClick}
        disabled={state === "running"}
        title={stderr || "Test connectivity"}
      >
        {state === "running" ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : state === "ok" ? (
          <Check className="w-4 h-4 text-green-500" />
        ) : state === "fail" ? (
          <AlertCircle className="w-4 h-4 text-destructive" />
        ) : (
          <span className="text-xs">Test</span>
        )}
      </Button>
    </div>
  );
}

// ============================================================================
// Connection form
// ============================================================================

interface SshConnectionFormProps {
  existing: SshConnectionDTO | null;
  onDone: () => void;
}

function SshConnectionForm({ existing, onDone }: SshConnectionFormProps) {
  const { create, update, fetchPublicKey } = useSshConnections();

  const [name, setName] = useState(existing?.name ?? "");
  const [host, setHost] = useState(existing?.host ?? "");
  const [port, setPort] = useState(String(existing?.port ?? 22));
  const [username, setUsername] = useState(existing?.username ?? "");
  const [authType, setAuthType] = useState<SshAuthType>(existing?.authType ?? "key");
  const [password, setPassword] = useState("");
  const [hasPassphrase, setHasPassphrase] = useState(existing?.hasPassphrase ?? false);
  const [knownHostsPolicy, setKnownHostsPolicy] = useState<SshKnownHostsPolicy>(
    existing?.knownHostsPolicy ?? "accept-new"
  );
  const [extraOptionsRaw, setExtraOptionsRaw] = useState(
    (existing?.extraOptions ?? []).join("\n")
  );

  const [keyMode, setKeyMode] = useState<"paste" | "upload" | "generate" | "existing">(
    existing ? "existing" : "paste"
  );
  const [pastedKey, setPastedKey] = useState("");
  const [pastedPubKey, setPastedPubKey] = useState("");
  const [generatedPublicKey, setGeneratedPublicKey] = useState<string | null>(null);
  const [loadedPublicKey, setLoadedPublicKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Load existing public key on mount when editing.
  useEffect(() => {
    if (!existing || existing.authType !== "key") return;
    let cancelled = false;
    void fetchPublicKey(existing.id)
      .then((pk) => {
        if (!cancelled) setLoadedPublicKey(pk);
      })
      .catch(() => {
        // 404 / unavailable — ignore.
      });
    return () => {
      cancelled = true;
    };
  }, [existing, fetchPublicKey]);

  const handleSubmit = async () => {
    setSaving(true);
    setFormError(null);
    try {
      const portNum = Number.parseInt(port, 10);
      if (!Number.isFinite(portNum) || portNum < 1 || portNum > 65535) {
        throw new Error("Port must be an integer between 1 and 65535");
      }
      const extraOptions = extraOptionsRaw
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);

      const payload: CreateSshConnectionPayload = {
        name,
        host,
        port: portNum,
        username,
        authType,
        knownHostsPolicy,
        extraOptions,
        hasPassphrase: authType === "key" ? hasPassphrase : false,
      };

      if (authType === "password") {
        if (!password && !existing) {
          throw new Error("Password is required");
        }
        if (password) payload.password = password;
      }

      if (authType === "key") {
        if (keyMode === "paste") {
          if (pastedKey.trim()) {
            payload.privateKey = pastedKey;
            if (pastedPubKey.trim()) payload.publicKey = pastedPubKey;
          } else if (!existing) {
            throw new Error("Paste a private key, choose Generate, or pick Upload");
          }
        } else if (keyMode === "generate") {
          payload.generateKeypair = true;
        }
        // "existing" / "upload" handled by file selection below before submit.
      }

      let publicKey: string | null = null;
      if (existing) {
        const res = await update(existing.id, payload);
        publicKey = res.publicKey;
      } else {
        const res = await create(payload);
        publicKey = res.publicKey;
      }

      if (publicKey) {
        setGeneratedPublicKey(publicKey);
      }

      // Auto-close on update only — leave open after generate so the user
      // can copy the public key.
      if (!publicKey) {
        onDone();
      }
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const handleUpload = async (file: File) => {
    const text = await file.text();
    setPastedKey(text);
    setKeyMode("paste");
  };

  const displayPublicKey = generatedPublicKey ?? loadedPublicKey;

  const copyPublicKey = async () => {
    if (!displayPublicKey) return;
    await navigator.clipboard.writeText(displayPublicKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="ssh-name">Name</Label>
          <Input
            id="ssh-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="prod-bastion"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ssh-host">Host</Label>
          <Input
            id="ssh-host"
            value={host}
            onChange={(e) => setHost(e.target.value)}
            placeholder="example.com"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ssh-port">Port</Label>
          <Input
            id="ssh-port"
            value={port}
            onChange={(e) => setPort(e.target.value)}
            placeholder="22"
            inputMode="numeric"
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="ssh-user">Username</Label>
          <Input
            id="ssh-user"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="ubuntu"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label>Auth method</Label>
        <Tabs value={authType} onValueChange={(v) => setAuthType(v as SshAuthType)}>
          <TabsList className="grid grid-cols-4 w-full">
            <TabsTrigger value="key">Key</TabsTrigger>
            <TabsTrigger value="agent">Agent</TabsTrigger>
            <TabsTrigger value="password">Password</TabsTrigger>
            <TabsTrigger value="system">System</TabsTrigger>
          </TabsList>
          <TabsContent value="key" className="space-y-3 pt-3">
            {existing && (
              <p className="text-xs text-muted-foreground">
                A private key is already stored for this connection. Use the
                tabs below to overwrite it.
              </p>
            )}
            <div className="flex gap-2 text-xs">
              <button
                type="button"
                className={tabBtnClass(keyMode === "paste")}
                onClick={() => setKeyMode("paste")}
              >
                Paste
              </button>
              <label className={tabBtnClass(false) + " cursor-pointer"}>
                Upload
                <input
                  type="file"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void handleUpload(f);
                  }}
                />
              </label>
              <button
                type="button"
                className={tabBtnClass(keyMode === "generate")}
                onClick={() => setKeyMode("generate")}
              >
                Generate ed25519
              </button>
            </div>

            {keyMode === "paste" && (
              <>
                <textarea
                  value={pastedKey}
                  onChange={(e) => setPastedKey(e.target.value)}
                  rows={6}
                  spellCheck={false}
                  placeholder="-----BEGIN OPENSSH PRIVATE KEY-----&#10;..."
                  className="w-full font-mono text-xs p-2 rounded-md bg-card border border-border"
                />
                <Input
                  value={pastedPubKey}
                  onChange={(e) => setPastedPubKey(e.target.value)}
                  placeholder="Optional public key (ssh-ed25519 ...) — auto-populated when not provided"
                />
              </>
            )}

            {keyMode === "generate" && (
              <p className="text-xs text-muted-foreground">
                Server will generate an ed25519 keypair when you save. The
                public key will appear here for you to copy into the remote
                host&apos;s <code>~/.ssh/authorized_keys</code>.
              </p>
            )}

            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={hasPassphrase}
                onChange={(e) => setHasPassphrase(e.target.checked)}
              />
              This key is passphrase-protected (OpenSSH will prompt at
              connect-time; the passphrase is never stored)
            </label>
          </TabsContent>
          <TabsContent value="agent" className="pt-3">
            <p className="text-xs text-muted-foreground">
              Forwards your local SSH agent (<code>-A</code>) and relies on the
              <code>SSH_AUTH_SOCK</code> environment variable being available
              to the terminal server.
            </p>
          </TabsContent>
          <TabsContent value="password" className="space-y-3 pt-3">
            <div className="rounded-md border border-yellow-500/40 bg-yellow-500/10 p-2 text-xs text-yellow-600 dark:text-yellow-300">
              Password auth requires <code>sshpass</code> on the server&apos;s
              PATH. Install with <code>brew install sshpass</code> (macOS) or
              your distro&apos;s package manager (Linux).
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ssh-pwd">
                Password {existing ? "(leave blank to keep)" : ""}
              </Label>
              <Input
                id="ssh-pwd"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
              />
            </div>
          </TabsContent>
          <TabsContent value="system" className="pt-3">
            <p className="text-xs text-muted-foreground">
              No flags will be added — relies on your <code>~/.ssh/config</code>{" "}
              and any matching <code>IdentityFile</code> / <code>Host</code>{" "}
              entries.
            </p>
          </TabsContent>
        </Tabs>
      </div>

      <details className="rounded-md border border-border bg-card/30">
        <summary className="cursor-pointer text-sm font-medium p-3">
          Advanced
        </summary>
        <div className="space-y-3 px-3 pb-3">
          <div className="space-y-1.5">
            <Label>Known hosts policy</Label>
            <Select
              value={knownHostsPolicy}
              onValueChange={(v) => setKnownHostsPolicy(v as SshKnownHostsPolicy)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="accept-new">accept-new (default)</SelectItem>
                <SelectItem value="strict">strict</SelectItem>
                <SelectItem value="no">no (warning: skips host verification)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ssh-extra">
              Extra <code>ssh</code> args (one per line)
            </Label>
            <textarea
              id="ssh-extra"
              value={extraOptionsRaw}
              onChange={(e) => setExtraOptionsRaw(e.target.value)}
              rows={3}
              spellCheck={false}
              className="w-full font-mono text-xs p-2 rounded-md bg-card border border-border"
              placeholder="-o ServerAliveInterval=60"
            />
          </div>
        </div>
      </details>

      {displayPublicKey && (
        <div className="space-y-2 rounded-md border border-border p-3 bg-card/50">
          <div className="flex items-center justify-between">
            <Label className="text-xs">Public key</Label>
            <Button variant="ghost" size="sm" onClick={copyPublicKey}>
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              <span className="ml-1 text-xs">{copied ? "Copied" : "Copy"}</span>
            </Button>
          </div>
          <pre className="text-[11px] font-mono break-all whitespace-pre-wrap text-muted-foreground">
            {displayPublicKey}
          </pre>
        </div>
      )}

      {formError && (
        <div className="flex items-start gap-2 p-3 rounded-md border border-destructive/40 bg-destructive/10 text-destructive text-sm">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{formError}</span>
        </div>
      )}

      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" onClick={onDone} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={handleSubmit} disabled={saving}>
          {saving && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
          {existing ? "Save changes" : "Create connection"}
        </Button>
      </div>
    </div>
  );
}

function tabBtnClass(active: boolean): string {
  return [
    "px-2 py-1 rounded border text-xs",
    active
      ? "bg-primary/15 text-primary border-primary/40"
      : "bg-card border-border text-muted-foreground hover:text-foreground",
  ].join(" ");
}
