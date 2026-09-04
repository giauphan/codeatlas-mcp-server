import { describe, it } from "node:test";
import * as assert from "node:assert";
import { execFileSync, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const TEMP_HOME = path.join(os.tmpdir(), `codeatlas-test-${Date.now()}`);
const CLAUDE_HOOKS_DIR = path.join(TEMP_HOME, '.claude', 'hooks');
const SETTINGS_FILE = path.join(TEMP_HOME, '.claude', 'settings.json');

describe("setup-hook command", () => {
  it("installs hooks correctly via CLI", async () => {
    // Create temp directory for this test
    fs.mkdirSync(TEMP_HOME, { recursive: true });
    
    try {
      // Run setup-hook command with temporary HOME
      const result = spawnSync("node", ["dist/index.js", "setup-hook"], {
        encoding: "utf8",
        env: { ...process.env, HOME: TEMP_HOME },
        cwd: process.cwd(),
      });
      
      assert.strictEqual(result.status, 0, result.stderr);
      assert.ok(result.stdout.includes("Hooks installed successfully"));
      
      // Verify hook files were created
      assert.ok(fs.existsSync(path.join(CLAUDE_HOOKS_DIR, 'brain-save.sh')));
      assert.ok(fs.existsSync(path.join(CLAUDE_HOOKS_DIR, 'brain-context.sh')));
      assert.ok(fs.existsSync(path.join(CLAUDE_HOOKS_DIR, 'task-router.sh')));
      assert.ok(fs.existsSync(path.join(CLAUDE_HOOKS_DIR, 'codeatlas')));
      
      // Verify settings.json was created with hooks (nested format)
      assert.ok(fs.existsSync(SETTINGS_FILE));
      const settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
      assert.ok(settings.hooks);
      assert.ok(settings.hooks.PreToolUse);
      assert.ok(settings.hooks.PostToolUse);
      assert.ok(settings.hooks.SessionStart);

      // Verify hook registration uses nested format
      assert.ok(settings.hooks.PreToolUse[0].hooks);
      assert.ok(settings.hooks.SessionStart[0].hooks);
      assert.ok(settings.hooks.PostToolUse[0].hooks);

      // Check for codeatlas hooks in nested arrays
      const preToolUseHooks = settings.hooks.PreToolUse[0].hooks;
      const sessionStartHooks = settings.hooks.SessionStart[0].hooks;
      const postToolUseHooks = settings.hooks.PostToolUse[0].hooks;

      assert.ok(preToolUseHooks.some((h: any) => h.command === "codeatlas" && h.args?.includes("task-router")));
      assert.ok(sessionStartHooks.some((h: any) => h.command === "codeatlas" && h.args?.includes("brain-context")));
      assert.ok(postToolUseHooks.some((h: any) => h.command === "codeatlas" && h.args?.includes("brain-save")));
      
    } finally {
      // Clean up temp directory
      fs.rmSync(TEMP_HOME, { recursive: true, force: true });
    }
  });
  
  it("validates hooks correctly via CLI", async () => {
    // Create temp directory and install hooks first
    fs.mkdirSync(TEMP_HOME, { recursive: true });
    
    try {
      // First install hooks
      const installResult = spawnSync("node", ["dist/index.js", "setup-hook"], {
        encoding: "utf8",
        env: { ...process.env, HOME: TEMP_HOME },
        cwd: process.cwd(),
      });
      
      assert.strictEqual(installResult.status, 0, installResult.stderr);
      
      // Then validate hooks
      const validateResult = spawnSync("node", ["dist/index.js", "validate-hook"], {
        encoding: "utf8", 
        env: { ...process.env, HOME: TEMP_HOME },
        cwd: process.cwd(),
      });
      
      assert.strictEqual(validateResult.status, 0, validateResult.stderr);
      assert.ok(validateResult.stdout.includes("validation completed successfully"));
      
    } finally {
      // Clean up temp directory
      fs.rmSync(TEMP_HOME, { recursive: true, force: true });
    }
  });

  it("codeatlas wrapper works with new hook syntax", async () => {
    // Create temp directory and install hooks first
    fs.mkdirSync(TEMP_HOME, { recursive: true });
    
    try {
      // First install hooks
      const installResult = spawnSync("node", ["dist/index.js", "setup-hook"], {
        encoding: "utf8",
        env: { ...process.env, HOME: TEMP_HOME },
        cwd: process.cwd(),
      });
      
      assert.strictEqual(installResult.status, 0, installResult.stderr);
      
      // Test codeatlas wrapper shows usage
      const wrapperPath = path.join(CLAUDE_HOOKS_DIR, 'codeatlas');
      const usageResult = spawnSync("bash", [wrapperPath], {
        encoding: "utf8",
      });
      
      // Should exit with error code and show usage
      assert.notStrictEqual(usageResult.status, 0);
      assert.ok(usageResult.stderr.includes("usage: codeatlas hook"));
      
      // Test codeatlas wrapper executes brain-context hook
      const contextResult = spawnSync("bash", [wrapperPath, "hook", "brain-context"], {
        encoding: "utf8",
        env: {
          ...process.env,
          HOME: TEMP_HOME,
          CODEATLAS_INJECT_BRAIN_CONTEXT: "1",
          CODEATLAS_TEST_MODE: "1"
        },
      });
      
      assert.strictEqual(contextResult.status, 0, contextResult.stderr);
      assert.ok(contextResult.stdout.includes("Parser uses ESTree"));
      
    } finally {
      // Clean up temp directory  
      fs.rmSync(TEMP_HOME, { recursive: true, force: true });
    }
  });
});