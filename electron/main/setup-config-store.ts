import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SetupConfiguration } from "../../src/components/setup/types";

const SETUP_CONFIG_FILE = "setup-config.json";

interface PersistedSetupConfig {
  isComplete: true;
  config: SetupConfiguration;
}

function getSetupConfigPath(userDataPath: string): string {
  return join(userDataPath, SETUP_CONFIG_FILE);
}

function isSetupConfiguration(value: unknown): value is SetupConfiguration {
  if (!value || typeof value !== "object") {
    return false;
  }

  const config = value as Partial<SetupConfiguration>;
  return (
    typeof config.workingDirectory === "string" &&
    typeof config.nextPort === "number" &&
    typeof config.terminalPort === "number" &&
    typeof config.autoStart === "boolean" &&
    typeof config.checkForUpdates === "boolean" &&
    (config.wslDistribution === undefined ||
      typeof config.wslDistribution === "string")
  );
}

export function loadSetupConfig(
  userDataPath: string
): { isComplete: false } | PersistedSetupConfig {
  const configPath = getSetupConfigPath(userDataPath);

  if (!existsSync(configPath)) {
    return { isComplete: false };
  }

  try {
    const raw = readFileSync(configPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<PersistedSetupConfig>;

    if (parsed.isComplete !== true || !isSetupConfiguration(parsed.config)) {
      return { isComplete: false };
    }

    return {
      isComplete: true,
      config: parsed.config,
    };
  } catch {
    return { isComplete: false };
  }
}

export async function saveSetupConfig(
  config: SetupConfiguration,
  userDataPath: string
): Promise<void> {
  mkdirSync(userDataPath, { recursive: true });

  await writeFile(
    getSetupConfigPath(userDataPath),
    JSON.stringify(
      {
        isComplete: true,
        config,
      },
      null,
      2
    ),
    "utf8"
  );
}
