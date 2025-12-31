import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, vi } from "vitest";

// Reset all mocks between tests
beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// Mock console.error to fail tests on React errors
const originalError = console.error;
beforeEach(() => {
  console.error = (...args: unknown[]) => {
    // Ignore specific known warnings
    const message = args[0]?.toString() ?? "";
    if (
      message.includes("Warning: ReactDOM.render is no longer supported") ||
      message.includes("Warning: An update to")
    ) {
      return;
    }
    originalError.apply(console, args);
  };
});

afterEach(() => {
  console.error = originalError;
});
