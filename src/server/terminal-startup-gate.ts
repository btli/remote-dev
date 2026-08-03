/**
 * Keep every DB-backed terminal/callback endpoint unbound until migrations are
 * confirmed. A rejected readiness probe fails startup instead of exposing a
 * partially compatible lifecycle API during a rolling deploy.
 */
export async function startTerminalAfterSchemaReady(
  waitForSchema: () => Promise<void>,
  startTerminal: () => void,
): Promise<void> {
  await waitForSchema();
  startTerminal();
}
