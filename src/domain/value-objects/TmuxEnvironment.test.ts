import { describe, it, expect } from "vitest";
import { TmuxEnvironment } from "./TmuxEnvironment";
import { InvalidValueError } from "../errors/DomainError";

describe("TmuxEnvironment", () => {
  describe("create", () => {
    it("should create an environment from a plain object", () => {
      const env = TmuxEnvironment.create({
        HOME: "/home/user",
        PATH: "/usr/bin:/bin",
        MY_VAR: "value",
      });

      expect(env.get("HOME")).toBe("/home/user");
      expect(env.get("PATH")).toBe("/usr/bin:/bin");
      expect(env.get("MY_VAR")).toBe("value");
      expect(env.size).toBe(3);
    });

    it("should create an empty environment from empty object", () => {
      const env = TmuxEnvironment.create({});
      expect(env.size).toBe(0);
      expect(env.isEmpty()).toBe(true);
    });

    it("should reject invalid key - starts with number", () => {
      expect(() => TmuxEnvironment.create({ "1INVALID": "value" })).toThrow(
        InvalidValueError
      );
    });

    it("should reject invalid key - contains special characters", () => {
      expect(() => TmuxEnvironment.create({ "MY-VAR": "value" })).toThrow(
        InvalidValueError
      );
      expect(() => TmuxEnvironment.create({ "MY.VAR": "value" })).toThrow(
        InvalidValueError
      );
    });

    it("should reject empty key", () => {
      expect(() => TmuxEnvironment.create({ "": "value" })).toThrow(
        InvalidValueError
      );
    });

    it("should reject value with null byte", () => {
      expect(() =>
        TmuxEnvironment.create({ VAR: "hello\0world" })
      ).toThrow(InvalidValueError);
    });

    it("should accept keys starting with underscore", () => {
      const env = TmuxEnvironment.create({ _PRIVATE: "value" });
      expect(env.get("_PRIVATE")).toBe("value");
    });

    it("should accept lowercase keys", () => {
      const env = TmuxEnvironment.create({ my_var: "value" });
      expect(env.get("my_var")).toBe("value");
    });
  });

  describe("empty", () => {
    it("should create an empty environment", () => {
      const env = TmuxEnvironment.empty();
      expect(env.size).toBe(0);
      expect(env.isEmpty()).toBe(true);
    });
  });

  describe("merge", () => {
    it("should merge two environments with 'other' precedence", () => {
      const env1 = TmuxEnvironment.create({ A: "1", B: "2" });
      const env2 = TmuxEnvironment.create({ B: "3", C: "4" });

      const merged = env1.merge(env2, "other");

      expect(merged.get("A")).toBe("1"); // From env1
      expect(merged.get("B")).toBe("3"); // From env2 (other wins)
      expect(merged.get("C")).toBe("4"); // From env2
      expect(merged.size).toBe(3);
    });

    it("should merge two environments with 'this' precedence", () => {
      const env1 = TmuxEnvironment.create({ A: "1", B: "2" });
      const env2 = TmuxEnvironment.create({ B: "3", C: "4" });

      const merged = env1.merge(env2, "this");

      expect(merged.get("A")).toBe("1"); // From env1
      expect(merged.get("B")).toBe("2"); // From env1 (this wins)
      expect(merged.get("C")).toBe("4"); // From env2
      expect(merged.size).toBe(3);
    });

    it("should not modify original environments", () => {
      const env1 = TmuxEnvironment.create({ A: "1" });
      const env2 = TmuxEnvironment.create({ B: "2" });

      env1.merge(env2, "other");

      expect(env1.size).toBe(1);
      expect(env1.has("B")).toBe(false);
      expect(env2.size).toBe(1);
      expect(env2.has("A")).toBe(false);
    });
  });

  describe("get and has", () => {
    it("should return undefined for missing keys", () => {
      const env = TmuxEnvironment.create({ A: "1" });
      expect(env.get("MISSING")).toBeUndefined();
    });

    it("should correctly report key presence", () => {
      const env = TmuxEnvironment.create({ A: "1" });
      expect(env.has("A")).toBe(true);
      expect(env.has("MISSING")).toBe(false);
    });
  });

  describe("with", () => {
    it("should add a new variable", () => {
      const env = TmuxEnvironment.create({ A: "1" });
      const newEnv = env.with("B", "2");

      expect(newEnv.get("A")).toBe("1");
      expect(newEnv.get("B")).toBe("2");
      expect(newEnv.size).toBe(2);
    });

    it("should replace an existing variable", () => {
      const env = TmuxEnvironment.create({ A: "1" });
      const newEnv = env.with("A", "2");

      expect(newEnv.get("A")).toBe("2");
      expect(newEnv.size).toBe(1);
    });

    it("should not modify the original", () => {
      const env = TmuxEnvironment.create({ A: "1" });
      env.with("B", "2");

      expect(env.size).toBe(1);
      expect(env.has("B")).toBe(false);
    });

    it("should validate the new key", () => {
      const env = TmuxEnvironment.create({ A: "1" });
      expect(() => env.with("1INVALID", "value")).toThrow(InvalidValueError);
    });
  });

  describe("without", () => {
    it("should remove a variable", () => {
      const env = TmuxEnvironment.create({ A: "1", B: "2" });
      const newEnv = env.without("A");

      expect(newEnv.has("A")).toBe(false);
      expect(newEnv.get("B")).toBe("2");
      expect(newEnv.size).toBe(1);
    });

    it("should return same instance if key does not exist", () => {
      const env = TmuxEnvironment.create({ A: "1" });
      const newEnv = env.without("MISSING");

      expect(newEnv).toBe(env);
    });

    it("should not modify the original", () => {
      const env = TmuxEnvironment.create({ A: "1", B: "2" });
      env.without("A");

      expect(env.size).toBe(2);
      expect(env.has("A")).toBe(true);
    });
  });

  describe("pick", () => {
    it("should create environment with only specified keys", () => {
      const env = TmuxEnvironment.create({ A: "1", B: "2", C: "3" });
      const picked = env.pick(["A", "C"]);

      expect(picked.size).toBe(2);
      expect(picked.get("A")).toBe("1");
      expect(picked.get("C")).toBe("3");
      expect(picked.has("B")).toBe(false);
    });

    it("should ignore non-existent keys", () => {
      const env = TmuxEnvironment.create({ A: "1" });
      const picked = env.pick(["A", "MISSING"]);

      expect(picked.size).toBe(1);
      expect(picked.get("A")).toBe("1");
    });
  });

  describe("omit", () => {
    it("should create environment without specified keys", () => {
      const env = TmuxEnvironment.create({ A: "1", B: "2", C: "3" });
      const omitted = env.omit(["B"]);

      expect(omitted.size).toBe(2);
      expect(omitted.get("A")).toBe("1");
      expect(omitted.get("C")).toBe("3");
      expect(omitted.has("B")).toBe(false);
    });
  });

  describe("toRecord", () => {
    it("should convert to plain object", () => {
      const env = TmuxEnvironment.create({ A: "1", B: "2" });
      const record = env.toRecord();

      expect(record).toEqual({ A: "1", B: "2" });
    });

    it("should return empty object for empty environment", () => {
      const env = TmuxEnvironment.empty();
      expect(env.toRecord()).toEqual({});
    });
  });

  describe("equals", () => {
    it("should return true for equal environments", () => {
      const env1 = TmuxEnvironment.create({ A: "1", B: "2" });
      const env2 = TmuxEnvironment.create({ A: "1", B: "2" });

      expect(env1.equals(env2)).toBe(true);
    });

    it("should return false for different values", () => {
      const env1 = TmuxEnvironment.create({ A: "1" });
      const env2 = TmuxEnvironment.create({ A: "2" });

      expect(env1.equals(env2)).toBe(false);
    });

    it("should return false for different keys", () => {
      const env1 = TmuxEnvironment.create({ A: "1" });
      const env2 = TmuxEnvironment.create({ B: "1" });

      expect(env1.equals(env2)).toBe(false);
    });

    it("should return false for different sizes", () => {
      const env1 = TmuxEnvironment.create({ A: "1" });
      const env2 = TmuxEnvironment.create({ A: "1", B: "2" });

      expect(env1.equals(env2)).toBe(false);
    });
  });

  describe("iteration", () => {
    it("should be iterable with for...of", () => {
      const env = TmuxEnvironment.create({ A: "1", B: "2" });
      const entries: [string, string][] = [];

      for (const entry of env) {
        entries.push(entry);
      }

      expect(entries).toHaveLength(2);
      expect(entries).toContainEqual(["A", "1"]);
      expect(entries).toContainEqual(["B", "2"]);
    });

    it("should support forEach", () => {
      const env = TmuxEnvironment.create({ A: "1", B: "2" });
      const collected: Record<string, string> = {};

      env.forEach((value, key) => {
        collected[key] = value;
      });

      expect(collected).toEqual({ A: "1", B: "2" });
    });

    it("should iterate keys", () => {
      const env = TmuxEnvironment.create({ A: "1", B: "2" });
      const keys = [...env.keys()];

      expect(keys).toHaveLength(2);
      expect(keys).toContain("A");
      expect(keys).toContain("B");
    });

    it("should iterate values", () => {
      const env = TmuxEnvironment.create({ A: "1", B: "2" });
      const values = [...env.values()];

      expect(values).toHaveLength(2);
      expect(values).toContain("1");
      expect(values).toContain("2");
    });

    it("should iterate entries", () => {
      const env = TmuxEnvironment.create({ A: "1", B: "2" });
      const entries = [...env.entries()];

      expect(entries).toHaveLength(2);
      expect(entries).toContainEqual(["A", "1"]);
      expect(entries).toContainEqual(["B", "2"]);
    });
  });
});
