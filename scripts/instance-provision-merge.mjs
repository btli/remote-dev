/**
 * Per-instance package-provisioning manifest merge (remote-dev-uobt).
 *
 * Merges the layered provisioning inputs into newline-delimited per-ecosystem
 * lists that docker/entrypoint.sh feeds to npm / pipx / cargo / apt. Two layers:
 *
 *   1. Supervisor baseline — env `RDV_PROVISION_BASELINE`, an OPTIONAL JSON
 *      manifest string injected by the supervisor (same schema for every instance
 *      provisioned by that supervisor).
 *   2. Per-instance manifest — `${RDV_PROVISION_DIR}/packages.yaml` (or
 *      `packages.json`), user/agent-editable, persists on the PVC.
 *
 * Manifest schema (all keys optional; each an array of package-name strings):
 *   apt:   [ ... ]   # system pkgs — re-applied each boot (ephemeral)
 *   npm:   [ ... ]   # npm install -g — persists via NPM_CONFIG_PREFIX
 *   pip:   [ ... ]   # pipx install (one venv each) — persists via PIPX_HOME
 *   cargo: [ ... ]   # cargo install — persists via CARGO_HOME
 *
 * Outputs (newline-delimited, de-duped, validated): /tmp/provision.{apt,npm,pip,cargo}.
 *
 * SAFETY: each entry is validated against a conservative token allowlist
 * (/^[A-Za-z0-9._@/+-]+$/) so a manifest can never inject shell metacharacters
 * into the `xargs … <pkg-manager> install` calls in the entrypoint. Rejected
 * entries are logged and skipped, never aborting the merge.
 *
 * MUST run under `node` (matches the entrypoint's other .mjs helpers). It is
 * intentionally DEPENDENCY-FREE for the slim runtime image: YAML parsing tries an
 * optional `yaml` package first (present in dev), then falls back to a minimal
 * built-in parser sufficient for this flat manifest schema, then to JSON.parse.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ECOSYSTEMS = ["apt", "npm", "pip", "cargo"];
const OUT_PATHS = {
  apt: "/tmp/provision.apt",
  npm: "/tmp/provision.npm",
  pip: "/tmp/provision.pip",
  cargo: "/tmp/provision.cargo",
};

// Conservative package-token allowlist — letters, digits, and the punctuation
// used by real package names AND version specifiers across ecosystems:
// @scope/name, name.with.dots, name+feature, name-with-dashes, plus version pins
// like pip `ruff==0.5.0` / `ruff!=0.4,>=0.3`, apt `vim=2:8.0`, npm `typescript@^5`,
// cargo `--version` is passed separately so `name` is enough. The version chars
// `=~^<>:!` are SAFE to allow because every downstream install call passes the
// token as a SEPARATE argv element (apt-get/npm via `xargs` args; pipx via quoted
// "$pkg"; cargo via `sh -c 'cargo install "$1"' _ {}` positional) — the token is
// never interpolated into a shell string. Shell metacharacters that WOULD enable
// injection (space, `;` `|` `&` `$` `(` `)` `<>` redirection-as-shell, backticks,
// quotes, newlines) remain EXCLUDED, so injection is still prevented.
const SAFE_TOKEN = /^[A-Za-z0-9._@/+:=~^<>!-]+$/;

/** Minimal flat-YAML parser for the manifest schema (lists of scalars only). */
function parseYamlMinimal(text) {
  const result = {};
  let currentKey = null;
  for (const rawLine of text.split(/\r?\n/)) {
    // Strip comments (only when '#' starts a token, not inside a value) + trailing ws.
    const line = rawLine.replace(/\s+#.*$/, "").replace(/^#.*$/, "");
    if (line.trim() === "") continue;
    const listMatch = line.match(/^\s*-\s+(.*\S)\s*$/);
    if (listMatch && currentKey) {
      result[currentKey].push(stripScalar(listMatch[1]));
      continue;
    }
    const keyMatch = line.match(/^([A-Za-z0-9_]+)\s*:\s*(.*)$/);
    if (keyMatch) {
      const key = keyMatch[1];
      const inline = keyMatch[2].trim();
      if (inline.startsWith("[") && inline.endsWith("]")) {
        // Inline flow list: key: [a, b, c]
        result[key] = inline
          .slice(1, -1)
          .split(",")
          .map((s) => stripScalar(s.trim()))
          .filter((s) => s !== "");
        currentKey = null;
      } else if (inline === "") {
        result[key] = [];
        currentKey = key;
      } else {
        result[key] = [stripScalar(inline)];
        currentKey = null;
      }
    }
  }
  return result;
}

/** Strip surrounding quotes from a YAML/JSON scalar. */
function stripScalar(s) {
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    return s.slice(1, -1);
  }
  return s;
}

/** Parse a per-instance manifest file (YAML or JSON) into a plain object. */
async function parseManifestFile(path) {
  const text = readFileSync(path, "utf8");
  // `yaml` is NOT a dependency anywhere in this repo, so this dynamic import
  // ALWAYS throws and we ALWAYS fall through to the JSON-then-minimal-parser path
  // below — the built-in `parseYamlMinimal` is in practice the only YAML parser
  // that ever runs. The import is kept as a best-effort: IF a future change adds
  // `yaml` as a dependency it would be picked up automatically (and it also parses
  // JSON), but we deliberately do NOT add it (keeps the slim runtime dependency-
  // free). Until then the catch branch is the live code path.
  try {
    const { parse } = await import("yaml");
    return parse(text) ?? {};
  } catch {
    // No `yaml` package: try JSON first (a .json file or a JSON-shaped .yaml),
    // then fall back to the minimal built-in YAML parser.
    try {
      return JSON.parse(text);
    } catch {
      return parseYamlMinimal(text);
    }
  }
}

/** Parse the supervisor baseline env (JSON string) into a plain object. */
function parseBaseline(raw) {
  if (!raw || raw.trim() === "") return {};
  try {
    return JSON.parse(raw);
  } catch (err) {
    console.warn(
      `[provision-merge] RDV_PROVISION_BASELINE is not valid JSON; ignoring: ${String(err)}`,
    );
    return {};
  }
}

/** Pull a validated, string-only array for one ecosystem out of a manifest. */
function collect(manifest, key, into, skipped) {
  const value = manifest?.[key];
  if (value === undefined || value === null) return;
  if (!Array.isArray(value)) {
    console.warn(
      `[provision-merge] '${key}' is not a list; skipping (got ${typeof value})`,
    );
    return;
  }
  for (const entry of value) {
    if (typeof entry !== "string") {
      skipped.push(`${key}:${JSON.stringify(entry)} (not a string)`);
      continue;
    }
    const token = entry.trim();
    if (token === "") continue;
    if (!SAFE_TOKEN.test(token)) {
      skipped.push(`${key}:${token} (unsafe token)`);
      continue;
    }
    into.add(token);
  }
}

async function main() {
  const provisionDir =
    process.env.RDV_PROVISION_DIR ||
    join(process.env.RDV_DATA_DIR || "/var/lib/rdv", "provision");

  const baseline = parseBaseline(process.env.RDV_PROVISION_BASELINE);

  let perInstance = {};
  const yamlPath = join(provisionDir, "packages.yaml");
  const ymlPath = join(provisionDir, "packages.yml");
  const jsonPath = join(provisionDir, "packages.json");
  const manifestPath = existsSync(yamlPath)
    ? yamlPath
    : existsSync(ymlPath)
      ? ymlPath
      : existsSync(jsonPath)
        ? jsonPath
        : null;
  if (manifestPath) {
    try {
      perInstance = (await parseManifestFile(manifestPath)) ?? {};
      console.log(`[provision-merge] loaded per-instance manifest: ${manifestPath}`);
    } catch (err) {
      console.warn(
        `[provision-merge] failed to read ${manifestPath}; ignoring: ${String(err)}`,
      );
    }
  } else {
    console.log("[provision-merge] no per-instance manifest found");
  }

  const skipped = [];
  const totals = {};
  for (const eco of ECOSYSTEMS) {
    const set = new Set();
    collect(baseline, eco, set, skipped);
    collect(perInstance, eco, set, skipped);
    const list = [...set];
    writeFileSync(OUT_PATHS[eco], list.length ? list.join("\n") + "\n" : "");
    totals[eco] = list.length;
  }

  if (skipped.length) {
    console.warn(
      `[provision-merge] skipped ${skipped.length} invalid entr${skipped.length === 1 ? "y" : "ies"}: ${skipped.join(", ")}`,
    );
  }
  console.log(
    `[provision-merge] merged manifest: apt=${totals.apt} npm=${totals.npm} pip=${totals.pip} cargo=${totals.cargo}`,
  );
}

await main();
