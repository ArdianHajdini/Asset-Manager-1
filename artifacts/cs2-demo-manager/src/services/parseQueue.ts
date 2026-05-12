/**
 * Global serial queue for Tauri demo parse commands.
 *
 * Rust's source2-demo parser is CPU-bound and single-threaded per call.
 * Firing N parse jobs simultaneously (one per DemoCard on mount) saturates
 * all available cores and can OOM or crash the Tauri process.
 *
 * This module exposes a single `enqueueParseJob` helper that chains every
 * incoming task onto a shared promise tail — so at most ONE parse runs at
 * any given time, with the rest waiting in order.
 */

// The shared tail: every new job appends itself here.
let tail: Promise<void> = Promise.resolve();

/**
 * Enqueue a parse task to run after all previously queued tasks finish.
 * Returns a promise that resolves/rejects with the task's own result.
 *
 * Usage:
 *   const players = await enqueueParseJob(() => tauriParseDemoPlayers(path));
 */
export function enqueueParseJob<T>(task: () => Promise<T>): Promise<T> {
  // Attach this task to the tail; the tail itself never rejects so the
  // queue keeps draining even when individual tasks fail.
  const result = tail.then(() => task());
  tail = result.then(
    () => {},
    () => {},
  );
  return result;
}
