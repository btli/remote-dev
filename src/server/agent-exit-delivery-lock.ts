/**
 * Process-local serialization for one agent process generation's exit intent.
 * The terminal server is the single lifecycle writer for an RDV data directory;
 * sharing this lock between the HTTP callback and its liveness repair prevents
 * repair from claiming a notification receipt between exact-state persistence
 * and focus-aware notification delivery.
 */

const exitDeliveryTails = new Map<string, Promise<void>>();

function deliveryKey(sessionId: string, generation: number): string {
  return JSON.stringify([sessionId, generation]);
}

export async function acquireAgentExitDeliveryLock(
  sessionId: string,
  generation: number,
): Promise<() => void> {
  const key = deliveryKey(sessionId, generation);
  const previous = exitDeliveryTails.get(key) ?? Promise.resolve();
  let unlock!: () => void;
  const held = new Promise<void>((resolve) => { unlock = resolve; });
  const tail = previous.then(() => held);
  exitDeliveryTails.set(key, tail);
  await previous;

  let released = false;
  return () => {
    if (released) return;
    released = true;
    unlock();
    if (exitDeliveryTails.get(key) === tail) exitDeliveryTails.delete(key);
  };
}

export async function withAgentExitDeliveryLock<T>(
  sessionId: string,
  generation: number,
  operation: () => Promise<T>,
): Promise<T> {
  const release = await acquireAgentExitDeliveryLock(sessionId, generation);
  try {
    return await operation();
  } finally {
    release();
  }
}
