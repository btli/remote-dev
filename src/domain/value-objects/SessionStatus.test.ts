import { describe, it, expect } from "bun:test";
import { SessionStatus } from "./SessionStatus";
import { InvalidValueError, InvalidStateTransitionError } from "../errors/DomainError";

describe("SessionStatus", () => {
  describe("creation", () => {
    it("creates active status", () => {
      const status = SessionStatus.active();
      expect(status.isActive()).toBe(true);
      expect(status.toString()).toBe("active");
    });

    it("creates suspended status", () => {
      const status = SessionStatus.suspended();
      expect(status.isSuspended()).toBe(true);
      expect(status.toString()).toBe("suspended");
    });

    it("creates closed status", () => {
      const status = SessionStatus.closed();
      expect(status.isClosed()).toBe(true);
      expect(status.toString()).toBe("closed");
    });

    it("creates trashed status", () => {
      const status = SessionStatus.trashed();
      expect(status.isTrashed()).toBe(true);
      expect(status.toString()).toBe("trashed");
    });
  });

  describe("fromString", () => {
    it.each(["active", "suspended", "closed", "trashed"] as const)(
      "creates %s status from string",
      (value) => {
        const status = SessionStatus.fromString(value);
        expect(status.toString()).toBe(value);
      }
    );

    it("throws on invalid status string", () => {
      expect(() => SessionStatus.fromString("invalid")).toThrow(InvalidValueError);
    });

    it("throws on empty string", () => {
      expect(() => SessionStatus.fromString("")).toThrow(InvalidValueError);
    });
  });

  describe("query methods", () => {
    it("isTerminal returns true for closed and trashed", () => {
      expect(SessionStatus.closed().isTerminal()).toBe(true);
      expect(SessionStatus.trashed().isTerminal()).toBe(true);
      expect(SessionStatus.active().isTerminal()).toBe(false);
      expect(SessionStatus.suspended().isTerminal()).toBe(false);
    });

    it("canResume returns true only for suspended", () => {
      expect(SessionStatus.suspended().canResume()).toBe(true);
      expect(SessionStatus.active().canResume()).toBe(false);
      expect(SessionStatus.closed().canResume()).toBe(false);
      expect(SessionStatus.trashed().canResume()).toBe(false);
    });

    it("canSuspend returns true only for active", () => {
      expect(SessionStatus.active().canSuspend()).toBe(true);
      expect(SessionStatus.suspended().canSuspend()).toBe(false);
      expect(SessionStatus.closed().canSuspend()).toBe(false);
      expect(SessionStatus.trashed().canSuspend()).toBe(false);
    });
  });

  describe("state transitions", () => {
    describe("from active", () => {
      const active = SessionStatus.active();

      it("allows transition to suspended", () => {
        expect(active.canTransitionTo(SessionStatus.suspended())).toBe(true);
      });

      it("allows transition to closed", () => {
        expect(active.canTransitionTo(SessionStatus.closed())).toBe(true);
      });

      it("allows transition to trashed", () => {
        expect(active.canTransitionTo(SessionStatus.trashed())).toBe(true);
      });

      it("does not allow transition to active (self)", () => {
        expect(active.canTransitionTo(SessionStatus.active())).toBe(false);
      });
    });

    describe("from suspended", () => {
      const suspended = SessionStatus.suspended();

      it("allows transition to active (resume)", () => {
        expect(suspended.canTransitionTo(SessionStatus.active())).toBe(true);
      });

      it("allows transition to closed", () => {
        expect(suspended.canTransitionTo(SessionStatus.closed())).toBe(true);
      });

      it("allows transition to trashed", () => {
        expect(suspended.canTransitionTo(SessionStatus.trashed())).toBe(true);
      });

      it("does not allow transition to suspended (self)", () => {
        expect(suspended.canTransitionTo(SessionStatus.suspended())).toBe(false);
      });
    });

    describe("from closed", () => {
      const closed = SessionStatus.closed();

      it("allows transition to trashed", () => {
        expect(closed.canTransitionTo(SessionStatus.trashed())).toBe(true);
      });

      it("does not allow transition to active", () => {
        expect(closed.canTransitionTo(SessionStatus.active())).toBe(false);
      });

      it("does not allow transition to suspended", () => {
        expect(closed.canTransitionTo(SessionStatus.suspended())).toBe(false);
      });
    });

    describe("from trashed (terminal state)", () => {
      const trashed = SessionStatus.trashed();

      it("does not allow any transitions", () => {
        expect(trashed.canTransitionTo(SessionStatus.active())).toBe(false);
        expect(trashed.canTransitionTo(SessionStatus.suspended())).toBe(false);
        expect(trashed.canTransitionTo(SessionStatus.closed())).toBe(false);
        expect(trashed.canTransitionTo(SessionStatus.trashed())).toBe(false);
      });
    });
  });

  describe("validateTransitionTo", () => {
    it("succeeds for valid transition", () => {
      const active = SessionStatus.active();
      expect(() =>
        active.validateTransitionTo(SessionStatus.suspended(), "suspend")
      ).not.toThrow();
    });

    it("throws InvalidStateTransitionError for invalid transition", () => {
      const suspended = SessionStatus.suspended();
      expect(() =>
        suspended.validateTransitionTo(SessionStatus.suspended(), "suspend")
      ).toThrow(InvalidStateTransitionError);
    });

    it("throws for closed to active transition", () => {
      const closed = SessionStatus.closed();
      expect(() =>
        closed.validateTransitionTo(SessionStatus.active(), "resume")
      ).toThrow(InvalidStateTransitionError);
    });
  });

  describe("equality", () => {
    it("equals returns true for same status", () => {
      expect(SessionStatus.active().equals(SessionStatus.active())).toBe(true);
      expect(SessionStatus.suspended().equals(SessionStatus.suspended())).toBe(true);
    });

    it("equals returns false for different status", () => {
      expect(SessionStatus.active().equals(SessionStatus.suspended())).toBe(false);
      expect(SessionStatus.closed().equals(SessionStatus.trashed())).toBe(false);
    });
  });
});
