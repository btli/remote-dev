import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import {
  SecretsProvider,
  useSecretsContext,
} from "@/contexts/SecretsContext";

/**
 * Verifies node-keyed accessors on SecretsContext wrap the underlying
 * folder-keyed map (remote-dev-oqol.4.1 / remote-dev-w1ed Stage 1).
 */

function mockSecretsFetch(
  configs: Array<{ folderId: string; enabled: boolean } & Record<string, unknown>>,
) {
  global.fetch = vi.fn((url: string | URL | Request) => {
    if (String(url).includes("/api/secrets/configs")) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(configs),
      } as Response);
    }
    return Promise.resolve({
      ok: false,
      status: 404,
      json: () => Promise.resolve({}),
    } as Response);
  }) as unknown as typeof fetch;
}

describe("SecretsContext node-keyed accessors", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("getNodeSecretsConfig returns the same config as getConfigForFolder for a project id", async () => {
    mockSecretsFetch([
      {
        folderId: "proj-1",
        enabled: true,
        provider: "phase",
        providerConfig: {},
      },
    ]);

    const { result } = renderHook(() => useSecretsContext(), {
      wrapper: ({ children }) => (
        <SecretsProvider>{children}</SecretsProvider>
      ),
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    const folderView = result.current.getConfigForFolder("proj-1");
    const nodeView = result.current.getNodeSecretsConfig("project", "proj-1");
    expect(nodeView).not.toBeNull();
    expect(nodeView).toEqual(folderView);
  });

  it("nodeHasActiveSecrets returns true for enabled configs, false for missing or disabled", async () => {
    mockSecretsFetch([
      { folderId: "proj-enabled", enabled: true, provider: "phase", providerConfig: {} },
      { folderId: "proj-disabled", enabled: false, provider: "phase", providerConfig: {} },
    ]);

    const { result } = renderHook(() => useSecretsContext(), {
      wrapper: ({ children }) => (
        <SecretsProvider>{children}</SecretsProvider>
      ),
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.nodeHasActiveSecrets("project", "proj-enabled")).toBe(true);
    expect(result.current.nodeHasActiveSecrets("project", "proj-disabled")).toBe(false);
    expect(result.current.nodeHasActiveSecrets("project", "proj-missing")).toBe(false);
  });
});
