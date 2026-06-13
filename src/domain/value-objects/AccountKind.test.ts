import { describe, it, expect } from "vitest";
import { AccountKind } from "./AccountKind";
import { InvalidValueError } from "../errors/DomainError";

describe("AccountKind", () => {
  describe("creation", () => {
    it("creates subscription from string", () => {
      const kind = AccountKind.create("subscription");
      expect(kind.toString()).toBe("subscription");
      expect(kind.isSubscription()).toBe(true);
      expect(kind.isApiKey()).toBe(false);
    });

    it("creates api_key from string", () => {
      const kind = AccountKind.create("api_key");
      expect(kind.toString()).toBe("api_key");
      expect(kind.isApiKey()).toBe(true);
      expect(kind.isSubscription()).toBe(false);
    });

    it("subscription() factory", () => {
      expect(AccountKind.subscription().toString()).toBe("subscription");
    });

    it("apiKey() factory", () => {
      expect(AccountKind.apiKey().toString()).toBe("api_key");
    });

    it("throws on unknown value", () => {
      expect(() => AccountKind.create("oauth")).toThrow(InvalidValueError);
      expect(() => AccountKind.create("")).toThrow(InvalidValueError);
    });
  });

  describe("windowSemantics", () => {
    it("subscription → rolling_5h_7d", () => {
      expect(AccountKind.subscription().windowSemantics()).toBe("rolling_5h_7d");
    });

    it("api_key → rate_credits", () => {
      expect(AccountKind.apiKey().windowSemantics()).toBe("rate_credits");
    });
  });

  describe("equality", () => {
    it("equals true for same kind", () => {
      expect(AccountKind.subscription().equals(AccountKind.create("subscription"))).toBe(true);
    });

    it("equals false for different kind", () => {
      expect(AccountKind.subscription().equals(AccountKind.apiKey())).toBe(false);
    });
  });
});
