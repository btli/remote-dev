import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, vi } from "vitest";

// Global mocks for hooks that SessionMetadataBar consumes. Many project-tree
// tests render SessionRow (and therefore SessionMetadataBar) without wrapping
// in a PortProvider or stubbing network calls. Tests that need specific
// fixtures can override with `vi.mocked(...).mockReturnValueOnce(...)`.
vi.mock("@/hooks/useSessionGitStatus", () => ({
  useSessionGitStatus: vi.fn(() => ({
    gitStatus: null,
    loading: false,
    refresh: vi.fn(),
  })),
}));

vi.mock("@/contexts/PortContext", () => ({
  usePortContext: vi.fn(() => ({ allocations: [] })),
  usePortContextOptional: vi.fn(() => null),
  PortProvider: ({ children }: { children: unknown }) => children,
}));

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
