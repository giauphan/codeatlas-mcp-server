import { describe, it } from "node:test";
import * as assert from "node:assert";

import { classifyCommand, compareSemver, getNpmUpdateCommand, runNpmUpdate } from "./commands.js";

describe("CLI command routing", () => {
  it("routes update to the CLI instead of MCP startup", () => {
    assert.equal(classifyCommand(["node", "codeatlas", "update"]), "cli");
  });

  it("rejects unrecognized commands instead of MCP startup", () => {
    assert.equal(classifyCommand(["node", "codeatlas", "updat"]), "unknown");
  });

  it("keeps a command-less invocation available for MCP startup", () => {
    assert.equal(classifyCommand(["node", "codeatlas"]), "mcp");
  });

  it("routes help flags to the CLI instead of MCP startup", () => {
    assert.equal(classifyCommand(["node", "codeatlas", "--help"]), "cli");
    assert.equal(classifyCommand(["node", "codeatlas", "-h"]), "cli");
  });

  it("updates the globally installed npm package", () => {
    const command = getNpmUpdateCommand();
    assert.equal(command.command, "npm");
    assert.deepEqual(command.args, ["install", "--global", "codeatlas-mcp-server@latest"]);

    let received: { command: string; args: readonly string[] } | undefined;
    runNpmUpdate((file, args) => {
      received = { command: file, args };
      return { status: 0, signal: null, output: [], pid: 1, stdout: "", stderr: "", error: undefined };
    }, () => "1.5.8", () => "1.5.7");
    assert.deepEqual(received, command);
  });

  it("refuses a tagged version that would downgrade the installed package", () => {
    let called = false;
    assert.throws(
      () => runNpmUpdate(() => {
        called = true;
        return { status: 0, signal: null };
      }, () => "1.5.7", () => "3.0.1"),
      /not newer/
    );
    assert.equal(called, false);
  });

  it("compares semantic versions without accepting malformed input", () => {
    assert.equal(compareSemver("1.5.8", "1.5.7"), 1);
    assert.equal(compareSemver("1.5.7", "1.5.7"), 0);
    assert.equal(compareSemver("1.5.7", "3.0.1"), -1);
    assert.equal(compareSemver("latest", "1.5.7"), null);
  });
});
