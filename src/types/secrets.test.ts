import { describe, expect, it } from "vitest";
import {
  SECRETS_PROVIDERS,
  SUPPORTED_SECRETS_PROVIDERS,
} from "./secrets";

describe("SUPPORTED_SECRETS_PROVIDERS", () => {
  it("only exposes providers that are actually supported", () => {
    expect(SUPPORTED_SECRETS_PROVIDERS.map((provider) => provider.type)).toEqual([
      "phase",
    ]);
  });

  it("marks unsupported providers as not supported in the full catalog", () => {
    const unsupportedProviders = SECRETS_PROVIDERS
      .filter((provider) => !provider.supported)
      .map((provider) => provider.type);

    expect(unsupportedProviders).toEqual([
      "vault",
      "aws-secrets-manager",
      "1password",
    ]);
  });
});
