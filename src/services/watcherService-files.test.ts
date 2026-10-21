import { after, before, describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, mkdir, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { FSWatcher } from "chokidar";
import * as watcherService from "./watcherService.js";

describe("Workspace watcher file filtering", { timeout: 10_000 }, () => {
  let projectDir: string;
  let hiddenParentDir: string;
  let runningWatcher: FSWatcher;
  const originalProjectDir = process.env.CODEATLAS_PROJECT_DIR;
  const events: Array<[string, string]> = [];
  const excludedFiles = [
    "node_modules/package/index.js",
    "nested/node_modules/package/index.js",
    "dist/index.js",
    "nested/dist/index.js",
    "build/index.js",
    "logs/output.txt",
    "__pycache__/module.pyc",
    ".git/config",
    ".venv/lib/module.py",
    ".hidden/source.ts",
    "nested/.hidden/source.ts",
    ".env",
    "nested/.env",
    "nested/.secret.ts",
    "output.log",
    "nested/output.log",
    "module.pyc",
    "nested/module.pyc",
  ];

  before(async () => {
    const hiddenBaseDir = path.join(tmpdir(), ".codeatlas");
    await mkdir(hiddenBaseDir, { recursive: true });
    hiddenParentDir = await mkdtemp(path.join(hiddenBaseDir, "watcher-parent-"));
    projectDir = path.join(hiddenParentDir, "project");
    await mkdir(projectDir);
    process.env.CODEATLAS_PROJECT_DIR = projectDir;
    await mkdir(path.join(projectDir, "src"));
    await writeFile(path.join(projectDir, "src/existing.ts"), "initial");
    for (const relativePath of excludedFiles) {
      const filePath = path.join(projectDir, relativePath);
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, "initial");
    }

    watcherService.startWatcher();
    runningWatcher = watcherService.watcher;
    runningWatcher.on("all", (event, filePath) => {
      // Observe the real watcher without starting an analysis/network sync.
      if (watcherService.indexTimeout) clearTimeout(watcherService.indexTimeout);
      if (event === "add" || event === "change" || event === "unlink") {
        events.push([event, path.relative(projectDir, filePath)]);
      }
    });
    await once(runningWatcher, "ready");
  });

  after(async () => {
    watcherService.stopWatcher();
    if (runningWatcher) await runningWatcher.close();
    if (hiddenParentDir) await rm(hiddenParentDir, { recursive: true, force: true });
    if (originalProjectDir === undefined) delete process.env.CODEATLAS_PROJECT_DIR;
    else process.env.CODEATLAS_PROJECT_DIR = originalProjectDir;
  });

  it("excludes hidden/generated paths with either path separator without excluding similar names", () => {
    for (const relativePath of excludedFiles) {
      assert.equal(watcherService.shouldIgnoreWatcherPath(`/workspace/${relativePath}`), true, relativePath);
      const windowsPath = `C:\\workspace\\${relativePath.replaceAll("/", "\\")}`;
      assert.equal(watcherService.shouldIgnoreWatcherPath(windowsPath), true, windowsPath);
    }
    for (const relativePath of [
      "src/index.ts", "src/file.test.ts", "node_modules-extra/index.js",
      "distribution/index.ts", "build-tools/index.ts", "catalog/index.ts",
      "src/output.log.ts", "src/module.pyc.ts",
    ]) {
      assert.equal(watcherService.shouldIgnoreWatcherPath(`/workspace/${relativePath}`), false, relativePath);
      const windowsPath = `C:\\workspace\\${relativePath.replaceAll("/", "\\")}`;
      assert.equal(watcherService.shouldIgnoreWatcherPath(windowsPath), false, windowsPath);
    }
  });

  it("emits source add/change/unlink events and suppresses excluded filesystem changes", async () => {
    assert.deepEqual(events, [], "ignoreInitial suppresses existing source files");

    async function expectEvent(event: string, relativePath: string, change: () => Promise<unknown>) {
      const received = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          runningWatcher.off("all", onEvent);
          reject(new Error(`Missing ${event} event for ${relativePath}`));
        }, 3_000);
        function onEvent(actualEvent: string, filePath: string) {
          if (actualEvent === event && path.relative(projectDir, filePath) === relativePath) {
            clearTimeout(timer);
            runningWatcher.off("all", onEvent);
            resolve();
          }
        }
        runningWatcher.on("all", onEvent);
      });
      await change();
      await received;
    }

    const sourcePath = path.join("src", "new.ts");
    await expectEvent("add", sourcePath, () => writeFile(path.join(projectDir, sourcePath), "created"));
    await expectEvent("change", sourcePath, () => writeFile(path.join(projectDir, sourcePath), "updated source"));
    await expectEvent("unlink", sourcePath, () => unlink(path.join(projectDir, sourcePath)));

    for (const relativePath of excludedFiles) {
      await writeFile(path.join(projectDir, relativePath), "modified excluded file");
      await unlink(path.join(projectDir, relativePath));
      await writeFile(path.join(projectDir, relativePath), "recreated excluded file");
    }
    // Allow the filesystem notifications for excluded files to settle.
    await delay(200);
    assert.deepEqual(events, [
      ["add", sourcePath], ["change", sourcePath], ["unlink", sourcePath],
    ]);
    const watchedDirectories = Object.keys(runningWatcher.getWatched());
    for (const directory of ["node_modules", "dist", "build", "logs", "__pycache__", ".git", ".venv", ".hidden"]) {
      assert.equal(watchedDirectories.includes(path.join(projectDir, directory)), false, directory);
    }
  });
});
