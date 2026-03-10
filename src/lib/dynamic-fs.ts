/**
 * Runtime fs/path access that bypasses Turbopack's static file tracing.
 *
 * Turbopack analyzes static fs/path calls and tries to include all files
 * matching dynamic path patterns. For server-side code with user-provided
 * paths, this creates "overly broad pattern" warnings. Using require()
 * prevents Turbopack from tracing these calls at build time.
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const _fs: typeof import("node:fs") = require("node:fs");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const _fsp: typeof import("node:fs/promises") = require("node:fs/promises");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const _path: typeof import("node:path") = require("node:path");

export function getFs(): typeof import("node:fs") {
  return _fs;
}

export function getFsPromises(): typeof import("node:fs/promises") {
  return _fsp;
}

/** path.join that bypasses Turbopack file tracing */
export function runtimeJoin(...segments: string[]): string {
  return _path.join(...segments);
}

/** path.dirname that bypasses Turbopack file tracing */
export function runtimeDirname(p: string): string {
  return _path.dirname(p);
}

/** path.basename that bypasses Turbopack file tracing */
export function runtimeBasename(p: string): string {
  return _path.basename(p);
}
