import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import type { SetupConfiguration } from "@/components/setup/types";

const savedConfig: SetupConfiguration = {
  workingDirectory: "/tmp/remote-dev",
  nextPort: 6001,
  terminalPort: 6002,
  wslDistribution: "Ubuntu",
  autoStart: true,
  checkForUpdates: false,
};

async function importSetupStore() {
  const currentFile = fileURLToPath(import.meta.url);
  const storePath = resolve(
    dirname(currentFile),
    "../../electron/main/setup-config-store.ts"
  );
  const importedStore = (await import(pathToFileURL(storePath).href)) as {
    default?: typeof import("../../electron/main/setup-config-store");
  };

  return importedStore.default ??
    (importedStore as typeof import("../../electron/main/setup-config-store"));
}

describe("electron setup config store", () => {
  it("returns incomplete when no setup config has been saved", async () => {
    const store = await importSetupStore();
    expect(store).toBeDefined();

    const tempDir = mkdtempSync(join(tmpdir(), "rdv-setup-store-"));

    try {
      expect(store!.loadSetupConfig(tempDir)).toEqual({ isComplete: false });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("persists and reloads completed setup configuration", async () => {
    const store = await importSetupStore();
    expect(store).toBeDefined();

    const tempDir = mkdtempSync(join(tmpdir(), "rdv-setup-store-"));

    try {
      await store!.saveSetupConfig(savedConfig, tempDir);

      expect(store!.loadSetupConfig(tempDir)).toEqual({
        isComplete: true,
        config: savedConfig,
      });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
