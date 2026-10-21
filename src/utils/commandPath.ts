import fs from "node:fs";
import path from "node:path";

/** Resolve a command once so child processes never ask the OS to search PATH. */
export function resolveExecutable(command: string): string {
  if (path.isAbsolute(command)) return command;
  const extensions = process.platform === "win32"
    ? (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";")
    : [""];
  for (const directory of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!directory) continue;
    const absoluteDirectory = path.resolve(directory);
    for (const extension of extensions) {
      const candidate = path.join(absoluteDirectory, `${command}${extension}`);
      try {
        if (!fs.statSync(candidate).isFile()) continue;
        if (process.platform !== "win32") fs.accessSync(candidate, fs.constants.X_OK);
        return candidate;
      } catch { /* Continue searching PATH entries that are missing or inaccessible. */ }
    }
  }
  throw new Error(`Executable not found: ${command}`);
}
