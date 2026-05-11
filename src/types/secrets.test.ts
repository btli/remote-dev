import { describe, expect, it } from "vitest";
import { SECRETS_PROVIDERS } from "./secrets";

describe("SECRETS_PROVIDERS", () => {
  it("exposes phase as the only supported provider", () => {
    expect(SECRETS_PROVIDERS.map((provider) => provider.type)).toEqual(["phase"]);
  });
});
