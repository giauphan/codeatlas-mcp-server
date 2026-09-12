import type { SpawnSyncReturns } from "child_process";

export function checkSpawnResult<T>(result: SpawnSyncReturns<T>): void {
  if (result.error) throw result.error;
  if (result.status !== 0) {
    if (result.status === null && result.signal) {
      throw new Error(`Process killed by signal ${result.signal}`);
    }
    const signalMsg = result.signal ? ` (signal ${result.signal})` : "";
    throw new Error(`Process exited with status ${result.status}${signalMsg}`);
  }
}
