import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, symlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

test("Claude installer preserves every hook group and security setting across repeated installs", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "codeatlas-hooks-install-"));
  const home = path.join(root, "home");
  const claudeDir = path.join(home, ".claude");
  mkdirSync(claudeDir, { recursive: true });
  const settingsPath = path.join(claudeDir, "settings.json");
  const thirdParty = { type: "command", command: "vendor-hook", args: ["keep"], timeout: 22 };
  const settings = {
    permissions: { deny: ["Bash(rm -rf *)"] },
    hooks: {
      SessionStart: [
        { matcher: "startup", hooks: [thirdParty] },
        { matcher: "resume", hooks: [{ type: "command", command: "another-vendor" }] },
      ],
      PostToolUse: [{ matcher: "Bash", hooks: [thirdParty] }],
      PreToolUse: [{ matcher: "*", hooks: [{ type: "command", command: "vendor-guard" }] }],
    },
  };
  writeFileSync(settingsPath, JSON.stringify(settings));
  const installer = path.resolve("scripts/setup-hooks.js");
  try {
    for (let i = 0; i < 2; i++) {
      const result = spawnSync(process.execPath, [installer], { cwd: process.cwd(), env: { ...process.env, HOME: home }, encoding: "utf8" });
      assert.equal(result.status, 0, result.stderr);
    }
    const installed = JSON.parse(readFileSync(settingsPath, "utf8"));
    assert.deepEqual(installed.permissions, settings.permissions);
    assert.deepEqual(installed.hooks.SessionStart[0], settings.hooks.SessionStart[0]);
    assert.deepEqual(installed.hooks.SessionStart[1], settings.hooks.SessionStart[1]);
    assert.ok(installed.hooks.SessionStart.some((group: any) => group.hooks?.some((hook: any) => hook.command?.endsWith("hook brain-context") && !hook.args)));
    assert.ok(installed.hooks.Stop.some((group: any) => group.hooks?.some((hook: any) => hook.command?.endsWith("hook brain-save"))));
    assert.ok(installed.hooks.PreCompact.some((group: any) => group.hooks?.some((hook: any) => hook.command?.endsWith("hook brain-save"))));
    assert.equal(installed.hooks.SessionStart.flatMap((group: any) => group.hooks ?? []).filter((hook: any) => hook.command?.endsWith("hook brain-context")).length, 1);
    assert.ok(JSON.stringify(installed).includes("Bash(rm -rf *)"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

for (const entrypoint of ["src/cli/hooks/install-brain-hooks.sh", "src/cli/hooks/update-settings.py"]) {
  test(`${entrypoint} delegates safely, upgrades owned legacy routes and preserves every matcher group`, () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "codeatlas-legacy-install-"));
    const home = path.join(root, "home");
    const settingsPath = path.join(home, ".claude", "settings.json");
    mkdirSync(path.dirname(settingsPath), { recursive: true });
    const vendor = { matcher: "resume", hooks: [{ type: "command", command: "/vendor/audit.sh" }] };
    writeFileSync(settingsPath, JSON.stringify({ permissions: { deny: ["Bash(rm -rf *)"] }, hooks: { SessionStart: [vendor, { matcher: "startup", hooks: [{ type: "command", command: "/home/previous/.claude/hooks/brain-context.sh" }] }] } }));
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        const command = entrypoint.endsWith(".py") ? "python3" : "bash";
        const result = spawnSync(command, [path.resolve(entrypoint), ...(entrypoint.endsWith(".py") ? [settingsPath] : [])], { cwd: root, env: { ...process.env, HOME: home }, encoding: "utf8" });
        assert.equal(result.status, 0, result.stderr);
      }
      const installed = JSON.parse(readFileSync(settingsPath, "utf8"));
      assert.deepEqual(installed.hooks.SessionStart[0], vendor);
      assert.deepEqual(installed.permissions.deny, ["Bash(rm -rf *)"]);
      assert.equal(installed.hooks.SessionStart.flatMap((group: any) => group.hooks ?? []).length, 2);
      assert.ok(installed.hooks.Stop && installed.hooks.PreCompact);
      const route = installed.hooks.SessionStart.flatMap((group: any) => group.hooks ?? []).find((hook: any) => hook.command?.endsWith("hook brain-context"));
      assert.ok(route && !route.args);
      const execution = spawnSync("bash", ["-c", route.command], { cwd: root, env: { ...process.env, HOME: home, CODEATLAS_INJECT_BRAIN_CONTEXT: "0" }, input: JSON.stringify({ hook_event_name: "SessionStart", cwd: root, session_id: "installer-fixture" }), encoding: "utf8", timeout: 5_000 });
      assert.equal(execution.status, 0, execution.stderr);
      assert.equal(execution.stdout, "");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
}

test("installer refuses unreadable settings without replacing security policy", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "codeatlas-invalid-install-"));
  mkdirSync(path.join(root, ".claude"), { recursive: true });
  const settingsPath = path.join(root, ".claude", "settings.json");
  const original = '{"permissions":{"deny":["all"]},';
  writeFileSync(settingsPath, original);
  try {
    const result = spawnSync("python3", [path.resolve("src/cli/hooks/update-settings.py"), settingsPath], { env: { ...process.env, HOME: root }, encoding: "utf8" });
    assert.notEqual(result.status, 0);
    assert.equal(readFileSync(settingsPath, "utf8"), original);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("installer refuses hook asset symlinks instead of overwriting their targets", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "codeatlas-hooks-symlink-"));
  const home = path.join(root, "home");
  const claudeDir = path.join(home, ".claude");
  const hooksDir = path.join(claudeDir, "hooks");
  const outside = path.join(root, "outside.sh");
  mkdirSync(hooksDir, { recursive: true });
  writeFileSync(outside, "preserve me\n");
  symlinkSync(outside, path.join(hooksDir, "brain-save.sh"));
  try {
    const result = spawnSync(process.execPath, [path.resolve("scripts/setup-hooks.js")], { env: { ...process.env, HOME: home }, encoding: "utf8" });
    assert.notEqual(result.status, 0);
    assert.equal(readFileSync(outside, "utf8"), "preserve me\n");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("compiled setup-hook and validator locate packaged scripts from an unrelated working directory", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "codeatlas-compiled-setup-"));
  try {
    const cli = path.resolve("dist/index.js");
    const env = { PATH: process.env.PATH, HOME: root };
    for (const command of ["setup-hook", "validate-hooks"]) {
      const result = spawnSync(process.execPath, [cli, command], { cwd: root, env, encoding: "utf8", timeout: 15_000 });
      assert.equal(result.status, 0, result.stderr + result.stdout);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
