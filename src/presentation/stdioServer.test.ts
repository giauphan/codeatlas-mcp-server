import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";

type StartedServer = {
  child: ChildProcessWithoutNullStreams;
  response: Promise<Record<string, unknown>>;
};

function startServer(homeDir: string, projectDir: string): StartedServer {
  const childCoverageDir = path.join(homeDir, "v8-coverage");
  mkdirSync(childCoverageDir, { recursive: true });
  const child = spawn(process.execPath, [path.resolve("dist/index.js")], {
    // This black-box child must not add the entire server startup path to c8's
    // parent-process coverage report.
    env: {
      ...process.env,
      HOME: homeDir,
      CODEATLAS_PROJECT_DIR: projectDir,
      NODE_V8_COVERAGE: childCoverageDir,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });

  const response = new Promise<Record<string, unknown>>((resolve, reject) => {
    let output = "";
    let stderr = "";
    let settled = false;
    const fail = (message: string, cause?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      const details = stderr.trim() ? `\nstderr:\n${stderr.trim()}` : "";
      reject(new Error(`${message}${details}`, { cause }));
    };
    const timeout = setTimeout(() => fail("MCP initialize response timed out"), 10_000);

    child.once("error", (error) => fail("MCP server failed to start", error));
    child.once("exit", (code, signal) => {
      if (!settled) fail(`MCP server exited before initialize (code: ${code}, signal: ${signal})`);
    });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      const lineEnd = output.indexOf("\n");
      if (lineEnd === -1 || settled) return;

      try {
        const parsed = JSON.parse(output.slice(0, lineEnd));
        settled = true;
        clearTimeout(timeout);
        resolve(parsed);
      } catch (error) {
        fail("MCP server wrote an invalid initialize response", error);
      }
    });
  });

  child.stdin.write(`${JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "stdio-regression-test", version: "1.0.0" },
    },
  })}\n`);

  return { child, response };
}

async function stopServer(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await once(child, "exit");
}

test("multiple stdio MCP servers complete initialize", async (t) => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "codeatlas-mcp-test-"));
  const firstHome = path.join(tempDir, "first-home");
  const secondHome = path.join(tempDir, "second-home");
  const projectDir = path.join(tempDir, "project");
  mkdirSync(firstHome);
  mkdirSync(secondHome);
  mkdirSync(projectDir);

  const firstLegacyPid = path.join(firstHome, ".codeatlas", "mcp.pid");
  const secondLegacyPid = path.join(secondHome, ".codeatlas", "mcp.pid");
  mkdirSync(path.dirname(firstLegacyPid), { recursive: true });
  mkdirSync(path.dirname(secondLegacyPid), { recursive: true });
  writeFileSync(firstLegacyPid, "1234");
  writeFileSync(secondLegacyPid, "5678");

  const first = startServer(firstHome, projectDir);
  const second = startServer(secondHome, projectDir);
  t.after(async () => {
    await Promise.all([stopServer(first.child), stopServer(second.child)]);
    rmSync(tempDir, { recursive: true, force: true });
  });

  const [firstResponse, secondResponse] = await Promise.all([
    first.response,
    second.response,
  ]);

  assert.equal(firstResponse.jsonrpc, "2.0");
  assert.equal(secondResponse.jsonrpc, "2.0");
  assert.equal(existsSync(firstLegacyPid), false);
  assert.equal(existsSync(secondLegacyPid), false);
  assert.equal((firstResponse.result as { serverInfo: { name: string } }).serverInfo.name, "CodeAtlas");
  assert.equal((secondResponse.result as { serverInfo: { name: string } }).serverInfo.name, "CodeAtlas");
});
