// @vitest-environment node
import { describe, it, expect } from "vitest";
import { parseUnifiedDiff } from "../parseUnifiedDiff";

const SAMPLE = `diff --git a/src/a.ts b/src/a.ts
index 111..222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,3 +1,4 @@
 const x = 1;
-const y = 2;
+const y = 3;
+const z = 4;
diff --git a/README.md b/README.md
new file mode 100644
index 000..333
--- /dev/null
+++ b/README.md
@@ -0,0 +1 @@
+hello
`;

describe("parseUnifiedDiff", () => {
  it("splits into files with path + add/del counts", () => {
    const files = parseUnifiedDiff(SAMPLE);
    expect(files.map((f) => f.path)).toEqual(["src/a.ts", "README.md"]);
    expect(files[0].additions).toBe(2);
    expect(files[0].deletions).toBe(1);
    expect(files[1].additions).toBe(1);
    expect(files[1].deletions).toBe(0);
  });

  it("captures hunk lines with type", () => {
    const files = parseUnifiedDiff(SAMPLE);
    const types = files[0].lines.map((l) => l.type);
    expect(types).toContain("add");
    expect(types).toContain("del");
    expect(types).toContain("ctx");
    expect(types).toContain("meta");
  });

  it("strips the leading +/-/space marker from line text", () => {
    const files = parseUnifiedDiff(SAMPLE);
    const add = files[0].lines.find((l) => l.type === "add");
    expect(add?.text).toBe("const y = 3;");
    const ctx = files[0].lines.find((l) => l.type === "ctx");
    expect(ctx?.text).toBe("const x = 1;");
  });

  it("flags new-file status", () => {
    const files = parseUnifiedDiff(SAMPLE);
    expect(files[1].isNew).toBe(true);
    expect(files[0].isNew).toBe(false);
  });

  it("returns [] for empty input", () => {
    expect(parseUnifiedDiff("")).toEqual([]);
  });
});
