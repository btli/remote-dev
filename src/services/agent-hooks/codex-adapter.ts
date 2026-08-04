import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

const CODEX_HOOK_MARKER_PREFIX = "remote-dev:codex-hooks:v";
const CODEX_HOOK_MARKER = `${CODEX_HOOK_MARKER_PREFIX}1`;

interface CommandHook {
  type: "command";
  command: string;
  timeout: number;
}

interface HookGroup {
  matcher?: string;
  hooks: CommandHook[];
}

type HookMap = Record<string, unknown>;

/** Default-on after the local Codex hook smoke; set to 0 for instant rollback. */
export function codexHooksEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return env.RDV_CODEX_HOOKS_ENABLED !== "0";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRemoteDevCommand(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value.type !== "command" || typeof value.command !== "string") return false;
  const command = value.command.trimEnd();
  const hasOwnedSuffix = new RegExp(
    `# ${CODEX_HOOK_MARKER_PREFIX}\\d+$`,
  ).test(command);
  if (!hasOwnedSuffix) return false;

  // Current managed commands have a stable delivery preamble. The narrow
  // single-command form recognizes pre-release v0 installs. Do not treat a
  // wrapper or arbitrary user command as owned merely because it quotes the
  // public marker text somewhere in its body.
  const hasCurrentPreamble =
    command.startsWith("_RDV_DELIVERY=$(uuidgen ") &&
    command.includes('export RDV_HOOK_DELIVERY_ID="$_RDV_DELIVERY"; ');
  const hasDirectDispatch = command.includes(
    "if command -v rdv >/dev/null 2>&1; then rdv hook codex ",
  );
  const hasPayloadAwarePreToolDispatch =
    command.includes('_RDV_PAYLOAD=$(cat); _RDV_RC=127; ') &&
    command.includes("rdv hook codex pre-tool-use");
  const isCurrentManagedShape =
    hasCurrentPreamble && (hasDirectDispatch || hasPayloadAwarePreToolDispatch);
  const isLegacyManagedShape = new RegExp(
    `^rdv hook codex [a-z0-9-]+ # ${CODEX_HOOK_MARKER_PREFIX}\\d+$`,
  ).test(command);
  return isCurrentManagedShape || isLegacyManagedShape;
}

function withoutRemoteDevHooks(groups: unknown[]): unknown[] {
  return groups.flatMap((group) => {
    if (!isRecord(group)) return [group];
    if (isRemoteDevCommand(group)) return [];
    if (!Array.isArray(group.hooks)) return [group];

    const hooks = group.hooks.filter((hook) => !isRemoteDevCommand(hook));
    if (hooks.length === group.hooks.length) return [group];
    if (hooks.length === 0) return [];
    return [{ ...group, hooks }];
  });
}

/**
 * Codex records trust against each hook's command hash. Preserve every user
 * hook definition unchanged while replacing/removing only RDV-owned entries;
 * positional movement does not invalidate an unchanged user hash.
 */
function mergeRemoteDevGroup(groups: unknown[], desired: HookGroup): unknown[] {
  const next: unknown[] = [];
  let replaced = false;

  for (const group of groups) {
    if (!isRecord(group)) {
      next.push(group);
      continue;
    }

    if (isRemoteDevCommand(group)) {
      if (!replaced) {
        next.push(desired);
        replaced = true;
      }
      continue;
    }

    if (!Array.isArray(group.hooks)) {
      next.push(group);
      continue;
    }
    const managedIndices = group.hooks
      .map((hook, index) => isRemoteDevCommand(hook) ? index : -1)
      .filter((index) => index >= 0);
    if (managedIndices.length === 0) {
      next.push(group);
      continue;
    }

    const userHooks = group.hooks.filter((hook) => !isRemoteDevCommand(hook));
    if (userHooks.length === 0) {
      if (!replaced) {
        next.push(desired);
        replaced = true;
      }
      continue;
    }

    // A legacy mixed group can retain the refreshed RDV hook when its matcher
    // already has the desired semantics. Duplicate RDV hooks are removed.
    if (!replaced && group.matcher === desired.matcher) {
      const firstManaged = managedIndices[0]!;
      const hooks = group.hooks.flatMap((hook, index) => {
        if (!isRemoteDevCommand(hook)) return hook;
        return index === firstManaged ? desired.hooks[0]! : [];
      });
      next.push({ ...group, hooks });
      replaced = true;
    } else {
      // The matcher cannot host the desired lifecycle semantics. Leave its
      // user hook definitions untouched and use a dedicated managed group.
      next.push({ ...group, hooks: userHooks });
    }
  }

  if (!replaced) next.push(desired);
  return next;
}

const DELIVERY_ID_PREAMBLE =
  '_RDV_DELIVERY=$(uuidgen 2>/dev/null) || _RDV_DELIVERY="$$-$(date +%s)-${RANDOM:-0}"; ' +
  'case "$_RDV_DELIVERY" in ""|*[!A-Za-z0-9._-]*) _RDV_DELIVERY="$$-$(date +%s)-0" ;; esac; ' +
  'export RDV_HOOK_DELIVERY_ID="$_RDV_DELIVERY"; ';

function importTmuxEnvIfMissing(key: string): string {
  return (
    `if [ -z "\${${key}:-}" ] && [ -n "$_RDV_SN" ]; then ` +
    `_RDV_VALUE=$(tmux show-environment -t "$_RDV_SN" "${key}" 2>/dev/null) || true; ` +
    `case "$_RDV_VALUE" in "${key}="*) export "$_RDV_VALUE" ;; esac; fi; `
  );
}

const CURL_ENV_PREAMBLE =
  '_RDV_SN=$(tmux display-message -p "#{session_name}" 2>/dev/null) || true; ' +
  ["RDV_SESSION_ID", "RDV_AGENT_GENERATION", "RDV_API_KEY", "RDV_TERMINAL_SOCKET", "RDV_TERMINAL_PORT"]
    .map(importTmuxEnvIfMissing)
    .join("") +
  '[ -z "$RDV_SESSION_ID" ] && exit 0; ' +
  '[ -z "$RDV_AGENT_GENERATION" ] && exit 0; ' +
  '[ -z "$RDV_API_KEY" ] && exit 0; ';

function curlStatus(status: string, source?: string): string {
  const sourceParam = source ? `&source=${source}` : "";
  const path = `/internal/agent-status?sessionId=\${RDV_SESSION_ID}&generation=\${RDV_AGENT_GENERATION}&status=${status}${sourceParam}&deliveryId=\${RDV_HOOK_DELIVERY_ID}`;
  return (
    CURL_ENV_PREAMBLE +
    'if [ -n "$RDV_TERMINAL_SOCKET" ]; then ' +
    `curl --unix-socket "$RDV_TERMINAL_SOCKET" -fsS --connect-timeout 1 --max-time 2 --retry 1 --retry-max-time 2 --retry-all-errors -o /dev/null -H "Authorization: Bearer $RDV_API_KEY" -X POST "http://localhost${path}"; ` +
    "else " +
    `curl -fsS --connect-timeout 1 --max-time 2 --retry 1 --retry-max-time 2 --retry-all-errors -o /dev/null -H "Authorization: Bearer $RDV_API_KEY" -X POST "http://localhost:\${RDV_TERMINAL_PORT}${path}"; ` +
    "fi || true"
  );
}

function commandHook(event: string, fallbackStatus: string, timeout: number, source?: string): HookGroup {
  const command =
    DELIVERY_ID_PREAMBLE +
    `if command -v rdv >/dev/null 2>&1; then rdv hook codex ${event}; _RDV_RC=$?; ` +
    `if [ "$_RDV_RC" -ne 0 ]; then ${curlStatus(fallbackStatus, source)}; fi; ` +
    `else ${curlStatus(fallbackStatus, source)}; fi # ${CODEX_HOOK_MARKER}`;
  return { hooks: [{ type: "command", command, timeout }] };
}

/**
 * PreToolUse is the one event whose fallback status depends on its payload.
 * Capture stdin once so an rdv bridge that reads the payload and then fails
 * cannot erase request_user_input's waiting classification before curl retry.
 */
function preToolUseHook(): HookGroup {
  const fallbackClassifier =
    'try{' +
    'const p=JSON.parse(require("fs").readFileSync(0,"utf8"));' +
    'const n=typeof p.tool_name==="string"?p.tool_name:"";' +
    'const e=["Bash","unified_exec","local_shell","exec_command","functions.exec","functions.exec_command"].includes(n);' +
    'if(e){console.log(JSON.stringify({hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:"Shell execution is paused because the rdv hook bridge failed and Git identity policy cannot be enforced; retry after Remote Dev is repaired."}}));process.exit(2)}' +
    'process.exit(["request_user_input","functions.request_user_input","AskUserQuestion"].includes(n)?0:1)' +
    '}catch(_){console.log(JSON.stringify({hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:"Git identity policy could not safely inspect this tool request because the rdv hook bridge failed."}}));process.exit(2)}';
  const noRuntimeDenial = JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason:
        "Git identity policy is unavailable because neither rdv nor a JSON runtime could inspect this tool request.",
    },
  });
  const command =
    DELIVERY_ID_PREAMBLE +
    '_RDV_PAYLOAD=$(cat); _RDV_RC=127; _RDV_OUT=; _RDV_HAS_DENIAL=0; ' +
    `if command -v rdv >/dev/null 2>&1; then _RDV_OUT=$(printf '%s' "$_RDV_PAYLOAD" | rdv hook codex pre-tool-use); _RDV_RC=$?; fi; ` +
    'if [ -n "$_RDV_OUT" ]; then case "$_RDV_OUT" in ' +
    '*\'"permissionDecision":"deny"\'*) printf \'%s\\n\' "$_RDV_OUT"; _RDV_HAS_DENIAL=1 ;; ' +
    '*) if [ "$_RDV_RC" -eq 0 ]; then printf \'%s\\n\' "$_RDV_OUT"; fi ;; esac; fi; ' +
    'if [ "$_RDV_RC" -ne 0 ]; then _RDV_FALLBACK_STATUS=running; _RDV_JSON_RUNTIME=; ' +
    'if command -v bun >/dev/null 2>&1; then _RDV_JSON_RUNTIME=bun; ' +
    'elif command -v node >/dev/null 2>&1; then _RDV_JSON_RUNTIME=node; fi; ' +
    'if [ "$_RDV_HAS_DENIAL" -eq 0 ]; then ' +
    `if [ -n "$_RDV_JSON_RUNTIME" ]; then printf '%s' "$_RDV_PAYLOAD" | "$_RDV_JSON_RUNTIME" -e '${fallbackClassifier}'; _RDV_CLASS_RC=$?; ` +
    'if [ "$_RDV_CLASS_RC" -eq 0 ]; then _RDV_FALLBACK_STATUS=waiting; fi; ' +
    `else printf '%s\\n' '${noRuntimeDenial}'; fi; fi; ` +
    `${curlStatus("${_RDV_FALLBACK_STATUS}")}; fi # ${CODEX_HOOK_MARKER}`;
  return { hooks: [{ type: "command", command, timeout: 10 }] };
}

function desiredHooks(): Record<string, HookGroup> {
  return {
    SessionStart: {
      ...commandHook("session-start", "running", 5),
      matcher: "startup|resume|clear|compact",
    },
    UserPromptSubmit: commandHook("prompt-submit", "running", 5),
    PreToolUse: preToolUseHook(),
    PermissionRequest: commandHook("permission-request", "waiting", 5),
    PostToolUse: commandHook("post-tool-use", "running", 10),
    PreCompact: {
      ...commandHook("pre-compact", "compacting", 5),
      matcher: "manual|auto",
    },
    PostCompact: {
      ...commandHook("post-compact", "running", 5),
      matcher: "manual|auto",
    },
    SubagentStart: commandHook("subagent-start", "subagent", 5),
    SubagentStop: commandHook("subagent-stop", "running", 5, "subagent-stop"),
    Stop: commandHook("stop", "idle", 15),
    SessionEnd: commandHook("session-end", "ended", 3),
  };
}

export function mergeCodexHooks(existing: Record<string, unknown>): Record<string, unknown> {
  const rawHooks = existing.hooks;
  if (rawHooks !== undefined && !isRecord(rawHooks)) {
    throw new Error("Codex hooks.json has an invalid hooks object");
  }

  const existingHooks = (rawHooks ?? {}) as HookMap;
  const mergedHooks: HookMap = { ...existingHooks };
  for (const [event, group] of Object.entries(desiredHooks())) {
    const existingEvent = existingHooks[event];
    if (existingEvent !== undefined && !Array.isArray(existingEvent)) {
      throw new Error(`Codex hooks.json event ${event} must be an array`);
    }
    const current = existingEvent ?? [];
    mergedHooks[event] = mergeRemoteDevGroup(current, group);
  }

  return {
    ...existing,
    description:
      typeof existing.description === "string"
        ? existing.description
        : "Remote Dev lifecycle hooks. Review and trust them with Codex /hooks.",
    hooks: mergedHooks,
  };
}

export async function installCodexHooks(
  configRoot: string,
  explicitCodexHome?: string,
): Promise<void> {
  // Profile isolation and folder/session environment overrides can point
  // Codex somewhere other than HOME/.codex. The installer must write to the
  // exact directory the launched process receives as CODEX_HOME.
  const codexDir = explicitCodexHome ?? join(configRoot, ".codex");
  const hooksPath = join(codexDir, "hooks.json");
  let raw = "";
  let existing: Record<string, unknown> = {};

  try {
    raw = await readFile(hooksPath, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) {
      throw new Error("root value must be an object");
    }
    existing = parsed;
  } catch (error) {
    if (isRecord(error) && error.code === "ENOENT") {
      // A missing file is the only parse/read condition that may start fresh.
    } else {
      throw new Error(`Codex hooks.json contains invalid JSON: ${String(error)}`);
    }
  }

  const merged = mergeCodexHooks(existing);
  const semanticallyCurrent = raw !== "" && JSON.stringify(merged) === JSON.stringify(existing);
  if (semanticallyCurrent) {
    await chmod(hooksPath, 0o600);
    return;
  }
  const next = `${JSON.stringify(merged, null, 2)}\n`;

  await mkdir(codexDir, { recursive: true, mode: 0o700 });
  const tempPath = join(codexDir, `.hooks.json.${process.pid}.${randomUUID()}.tmp`);
  try {
    await writeFile(tempPath, next, { encoding: "utf8", mode: 0o600, flag: "wx" });
    await rename(tempPath, hooksPath);
    await chmod(hooksPath, 0o600);
  } catch (error) {
    await unlink(tempPath).catch(() => undefined);
    throw error;
  }
}

export interface CodexHookInspection {
  configured: boolean;
  error?: string;
}

/** Verify the on-disk managed lifecycle map without mutating Codex state. */
export async function inspectInstalledCodexHooks(
  configRoot: string,
  explicitCodexHome?: string,
): Promise<CodexHookInspection> {
  const codexDir = explicitCodexHome ?? join(configRoot, ".codex");
  const hooksPath = join(codexDir, "hooks.json");
  try {
    const raw = await readFile(hooksPath, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) {
      return { configured: false, error: "Codex hooks root is not an object" };
    }
    const repaired = mergeCodexHooks(parsed);
    if (JSON.stringify(repaired) !== JSON.stringify(parsed)) {
      return {
        configured: false,
        error: "Codex managed hooks are missing or drifted",
      };
    }
    return { configured: true };
  } catch (error) {
    return {
      configured: false,
      error: `Unable to read Codex hooks: ${String(error)}`,
    };
  }
}

/** Remove only Remote Dev-owned hook entries, preserving every user key/hook. */
export async function uninstallCodexHooks(
  configRoot: string,
  explicitCodexHome?: string,
): Promise<void> {
  const codexDir = explicitCodexHome ?? join(configRoot, ".codex");
  const hooksPath = join(codexDir, "hooks.json");
  let raw: string;
  let existing: Record<string, unknown>;

  try {
    raw = await readFile(hooksPath, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) throw new Error("root value must be an object");
    existing = parsed;
  } catch (error) {
    if (isRecord(error) && error.code === "ENOENT") return;
    throw new Error(`Codex hooks.json contains invalid JSON: ${String(error)}`);
  }

  if (existing.hooks !== undefined && !isRecord(existing.hooks)) {
    throw new Error("Codex hooks.json has an invalid hooks object");
  }
  const hooks = (existing.hooks ?? {}) as HookMap;
  const cleanedHooks: HookMap = {};
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) {
      cleanedHooks[event] = groups;
      continue;
    }
    const cleaned = withoutRemoteDevHooks(groups);
    if (cleaned.length > 0) cleanedHooks[event] = cleaned;
  }
  const cleaned = { ...existing, hooks: cleanedHooks };
  if (JSON.stringify(cleaned) === JSON.stringify(existing)) {
    await chmod(hooksPath, 0o600);
    return;
  }

  const tempPath = join(codexDir, `.hooks.json.${process.pid}.${randomUUID()}.tmp`);
  try {
    await writeFile(tempPath, `${JSON.stringify(cleaned, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    await rename(tempPath, hooksPath);
    await chmod(hooksPath, 0o600);
  } catch (error) {
    await unlink(tempPath).catch(() => undefined);
    throw error;
  }
}
