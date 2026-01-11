/**
 * SDK Configuration Tests
 */

import { describe, it, expect } from "vitest";
import {
  createConfig,
  validateConfig,
  DEFAULT_MEMORY_CONFIG,
  DEFAULT_META_AGENT_CONFIG,
  DEFAULT_ORCHESTRATOR_CONFIG,
  DEFAULT_SDK_CONFIG,
} from "./config";
import type { CreateSDKOptions, SDKConfig } from "../types";

describe("SDK Config", () => {
  describe("DEFAULT_MEMORY_CONFIG", () => {
    it("should have correct default values", () => {
      expect(DEFAULT_MEMORY_CONFIG.shortTermTtl).toBe(3600);
      expect(DEFAULT_MEMORY_CONFIG.maxWorkingEntries).toBe(100);
      expect(DEFAULT_MEMORY_CONFIG.consolidationInterval).toBe(300);
    });
  });

  describe("DEFAULT_META_AGENT_CONFIG", () => {
    it("should have correct default values", () => {
      expect(DEFAULT_META_AGENT_CONFIG.maxIterations).toBe(3);
      expect(DEFAULT_META_AGENT_CONFIG.targetScore).toBe(0.9);
      expect(DEFAULT_META_AGENT_CONFIG.autoOptimize).toBe(false);
    });
  });

  describe("DEFAULT_ORCHESTRATOR_CONFIG", () => {
    it("should have correct default values", () => {
      expect(DEFAULT_ORCHESTRATOR_CONFIG.monitoringInterval).toBe(30);
      expect(DEFAULT_ORCHESTRATOR_CONFIG.stallThreshold).toBe(300);
      expect(DEFAULT_ORCHESTRATOR_CONFIG.autoIntervention).toBe(false);
    });
  });

  describe("DEFAULT_SDK_CONFIG", () => {
    it("should have correct default values", () => {
      expect(DEFAULT_SDK_CONFIG.databasePath).toBe("sqlite.db");
      expect(DEFAULT_SDK_CONFIG.apiBaseUrl).toBe("http://localhost:6001");
    });
  });

  describe("createConfig", () => {
    it("should create config with minimal options", () => {
      const options: CreateSDKOptions = {
        userId: "user-123",
      };

      const config = createConfig(options);

      expect(config.userId).toBe("user-123");
      expect(config.databasePath).toBe("sqlite.db");
      expect(config.apiBaseUrl).toBe("http://localhost:6001");
      expect(config.memory).toEqual(DEFAULT_MEMORY_CONFIG);
      expect(config.metaAgent).toEqual(DEFAULT_META_AGENT_CONFIG);
      expect(config.orchestrator).toEqual(DEFAULT_ORCHESTRATOR_CONFIG);
    });

    it("should allow overriding default values", () => {
      const options: CreateSDKOptions = {
        userId: "user-456",
        databasePath: "/custom/path.db",
        apiBaseUrl: "http://custom:8000",
        folderId: "folder-789",
        projectPath: "/my/project",
      };

      const config = createConfig(options);

      expect(config.userId).toBe("user-456");
      expect(config.databasePath).toBe("/custom/path.db");
      expect(config.apiBaseUrl).toBe("http://custom:8000");
      expect(config.folderId).toBe("folder-789");
      expect(config.projectPath).toBe("/my/project");
    });

    it("should merge memory config with defaults", () => {
      const options: CreateSDKOptions = {
        userId: "user-123",
        memory: {
          shortTermTtl: 7200,
        },
      };

      const config = createConfig(options);

      expect(config.memory.shortTermTtl).toBe(7200);
      expect(config.memory.maxWorkingEntries).toBe(100); // default
      expect(config.memory.consolidationInterval).toBe(300); // default
    });

    it("should merge meta-agent config with defaults", () => {
      const options: CreateSDKOptions = {
        userId: "user-123",
        metaAgent: {
          maxIterations: 5,
          autoOptimize: true,
        },
      };

      const config = createConfig(options);

      expect(config.metaAgent.maxIterations).toBe(5);
      expect(config.metaAgent.autoOptimize).toBe(true);
      expect(config.metaAgent.targetScore).toBe(0.9); // default
    });

    it("should merge orchestrator config with defaults", () => {
      const options: CreateSDKOptions = {
        userId: "user-123",
        orchestrator: {
          stallThreshold: 600,
        },
      };

      const config = createConfig(options);

      expect(config.orchestrator.stallThreshold).toBe(600);
      expect(config.orchestrator.monitoringInterval).toBe(30); // default
      expect(config.orchestrator.autoIntervention).toBe(false); // default
    });
  });

  describe("validateConfig", () => {
    const validConfig: SDKConfig = {
      userId: "user-123",
      databasePath: "sqlite.db",
      apiBaseUrl: "http://localhost:6001",
      memory: {
        shortTermTtl: 3600,
        maxWorkingEntries: 100,
        consolidationInterval: 300,
      },
      metaAgent: {
        maxIterations: 3,
        targetScore: 0.9,
        autoOptimize: false,
      },
      orchestrator: {
        monitoringInterval: 30,
        stallThreshold: 300,
        autoIntervention: false,
      },
    };

    it("should pass with valid config", () => {
      expect(() => validateConfig(validConfig)).not.toThrow();
    });

    it("should throw if userId is missing", () => {
      const config = { ...validConfig, userId: "" };
      expect(() => validateConfig(config)).toThrow("requires a userId");
    });

    it("should throw if databasePath is missing", () => {
      const config = { ...validConfig, databasePath: "" };
      expect(() => validateConfig(config)).toThrow("requires a databasePath");
    });

    it("should throw if apiBaseUrl is missing", () => {
      const config = { ...validConfig, apiBaseUrl: "" };
      expect(() => validateConfig(config)).toThrow("requires an apiBaseUrl");
    });

    describe("memory config validation", () => {
      it("should throw if shortTermTtl is not positive", () => {
        const config = {
          ...validConfig,
          memory: { ...validConfig.memory, shortTermTtl: 0 },
        };
        expect(() => validateConfig(config)).toThrow("shortTermTtl must be positive");
      });

      it("should throw if shortTermTtl is negative", () => {
        const config = {
          ...validConfig,
          memory: { ...validConfig.memory, shortTermTtl: -1 },
        };
        expect(() => validateConfig(config)).toThrow("shortTermTtl must be positive");
      });

      it("should throw if maxWorkingEntries is not positive", () => {
        const config = {
          ...validConfig,
          memory: { ...validConfig.memory, maxWorkingEntries: 0 },
        };
        expect(() => validateConfig(config)).toThrow("maxWorkingEntries must be positive");
      });

      it("should throw if consolidationInterval is not positive", () => {
        const config = {
          ...validConfig,
          memory: { ...validConfig.memory, consolidationInterval: -5 },
        };
        expect(() => validateConfig(config)).toThrow("consolidationInterval must be positive");
      });
    });

    describe("meta-agent config validation", () => {
      it("should throw if maxIterations is not positive", () => {
        const config = {
          ...validConfig,
          metaAgent: { ...validConfig.metaAgent, maxIterations: 0 },
        };
        expect(() => validateConfig(config)).toThrow("maxIterations must be positive");
      });

      it("should throw if targetScore is below 0", () => {
        const config = {
          ...validConfig,
          metaAgent: { ...validConfig.metaAgent, targetScore: -0.1 },
        };
        expect(() => validateConfig(config)).toThrow("targetScore must be between 0 and 1");
      });

      it("should throw if targetScore is above 1", () => {
        const config = {
          ...validConfig,
          metaAgent: { ...validConfig.metaAgent, targetScore: 1.5 },
        };
        expect(() => validateConfig(config)).toThrow("targetScore must be between 0 and 1");
      });

      it("should accept targetScore at boundaries", () => {
        const configZero = {
          ...validConfig,
          metaAgent: { ...validConfig.metaAgent, targetScore: 0 },
        };
        expect(() => validateConfig(configZero)).not.toThrow();

        const configOne = {
          ...validConfig,
          metaAgent: { ...validConfig.metaAgent, targetScore: 1 },
        };
        expect(() => validateConfig(configOne)).not.toThrow();
      });
    });

    describe("orchestrator config validation", () => {
      it("should throw if monitoringInterval is not positive", () => {
        const config = {
          ...validConfig,
          orchestrator: { ...validConfig.orchestrator, monitoringInterval: 0 },
        };
        expect(() => validateConfig(config)).toThrow("monitoringInterval must be positive");
      });

      it("should throw if stallThreshold is not positive", () => {
        const config = {
          ...validConfig,
          orchestrator: { ...validConfig.orchestrator, stallThreshold: -10 },
        };
        expect(() => validateConfig(config)).toThrow("stallThreshold must be positive");
      });
    });
  });
});
