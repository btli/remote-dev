// @vitest-environment node
/**
 * LogDatabase test-env isolation (smwq).
 *
 * Under a test runner (vitest sets VITEST), the logger must open an in-memory
 * SQLite database instead of the real ~/.remote-dev/logs/logs.db, so the test
 * suite never pollutes the production logs database.
 */
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getLogDatabase, closeLogDatabase } from "./LogDatabase";

describe("LogDatabase test-env isolation", () => {
  let tmpDataDir: string;
  let prevDataDir: string | undefined;

  beforeEach(() => {
    closeLogDatabase();
    // Point the data dir at a throwaway location so we can assert the real
    // logs.db file is NEVER created under the test runner.
    tmpDataDir = join(tmpdir(), `rdv-logdb-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    prevDataDir = process.env.RDV_DATA_DIR;
    process.env.RDV_DATA_DIR = tmpDataDir;
  });

  afterEach(() => {
    closeLogDatabase();
    if (prevDataDir === undefined) {
      delete process.env.RDV_DATA_DIR;
    } else {
      process.env.RDV_DATA_DIR = prevDataDir;
    }
    rmSync(tmpDataDir, { recursive: true, force: true });
  });

  it("selects an in-memory database under VITEST (does not touch logs.db on disk)", () => {
    expect(process.env.VITEST).toBeTruthy();

    const db = getLogDatabase();
    expect(db).toBeTruthy();

    // The on-disk logs database file must not have been created.
    const logsDbPath = join(tmpDataDir, "logs", "logs.db");
    expect(existsSync(logsDbPath)).toBe(false);
    expect(existsSync(join(tmpDataDir, "logs"))).toBe(false);
  });

  it("keeps the in-memory sink fully functional (writes round-trip)", () => {
    const db = getLogDatabase();

    db.prepare(
      "INSERT INTO log_entry (ts, level, namespace, message, data, source) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(Date.now(), "info", "TestNamespace", "hello", null, "nextjs");

    const row = db
      .prepare("SELECT level, namespace, message FROM log_entry LIMIT 1")
      .get() as { level: string; namespace: string; message: string };

    expect(row).toEqual({
      level: "info",
      namespace: "TestNamespace",
      message: "hello",
    });

    // Still no on-disk file after a write.
    expect(existsSync(join(tmpDataDir, "logs", "logs.db"))).toBe(false);
  });
});
