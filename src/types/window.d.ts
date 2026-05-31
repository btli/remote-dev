/**
 * Shared global Window augmentations.
 *
 * `__RDV_BASE_PATH__` is injected by the SSR script in `src/app/layout.tsx`
 * so client code (`apiFetch`, `useTerminalWsUrl`, etc.) can read the
 * runtime basePath without baking it into the build. Declaring it here in
 * one place — rather than per-file — keeps the type available everywhere
 * regardless of import order.
 */
export {};

declare global {
  interface Window {
    __RDV_BASE_PATH__?: string;
  }
}
