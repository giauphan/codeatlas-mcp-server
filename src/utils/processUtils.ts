import type { SpawnSyncReturns } from "child_process";

export function checkSpawnResult(result: SpawnSyncReturns<string | Buffer>): void {
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Process exited with status ${result.status}`);
}
