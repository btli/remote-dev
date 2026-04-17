import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const buildGradlePath = resolve(process.cwd(), "mobile/android/app/build.gradle.kts");
const readmePath = resolve(process.cwd(), "mobile/README.md");

describe("Android release signing", () => {
  it("uses a dedicated release signing config instead of the debug keystore", () => {
    const buildGradle = readFileSync(buildGradlePath, "utf-8");

    expect(buildGradle).not.toContain(
      'signingConfig = signingConfigs.getByName("debug")'
    );
    expect(buildGradle).toContain('create("release")');
    expect(buildGradle).toContain('signingConfig = signingConfigs.getByName("release")');
  });

  it("supports env vars, falls back to key.properties, and fails clearly for misconfigured release builds", () => {
    const buildGradle = readFileSync(buildGradlePath, "utf-8");

    expect(buildGradle).toContain('rootProject.file("key.properties")');
    expect(buildGradle).toMatch(
      /providers\.environmentVariable\(envVar\).*releaseSigningProperties\.getProperty\(key\)/s
    );
    expect(buildGradle).toContain('it.contains("Release", ignoreCase = true)');
    expect(buildGradle).toContain("throw GradleException(");
    expect(buildGradle).toContain("Android release signing is not configured");
    expect(buildGradle).toContain("RDV_ANDROID_KEYSTORE_PATH");
    expect(buildGradle).toContain("RDV_ANDROID_KEYSTORE_PASSWORD");
    expect(buildGradle).toContain("RDV_ANDROID_KEY_ALIAS");
    expect(buildGradle).toContain("RDV_ANDROID_KEY_PASSWORD");
    expect(buildGradle).toContain("mobile/android/key.properties");
  });

  it("documents the required release signing secrets", () => {
    const readme = readFileSync(readmePath, "utf-8");

    expect(readme).toContain("RDV_ANDROID_KEYSTORE_PATH");
    expect(readme).toContain("RDV_ANDROID_KEYSTORE_PASSWORD");
    expect(readme).toContain("RDV_ANDROID_KEY_ALIAS");
    expect(readme).toContain("RDV_ANDROID_KEY_PASSWORD");
    expect(readme).toContain("mobile/android/key.properties");
    expect(readme).toContain("If both are present, the environment variables win.");
  });
});
