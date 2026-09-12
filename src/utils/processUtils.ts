import type { SpawnSyncReturns } from "child_process";

export function checkSpawnResult<T>(result: SpawnSyncReturns<T>): void {
  if (result.error) throw result.error;
  if (result.status !== 0) {
    if (result.status === null) {
      throw new Error(`Process terminated by ${result.signal ?? "unknown signal"}`);
    }
    throw new Error(`Process exited with status ${result.status}`);
  }
}
