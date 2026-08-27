import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import path from "node:path";
import process from "node:process";
import test from "node:test";

type StartedServer = {
  child: ChildProcessWithoutNullStreams;
  response: Promise<Record<string, unknown>>;
};

function startServer(): StartedServer {
  const child = spawn(process.execPath, [path.resolve("dist/index.js")], {
    stdio: ["pipe", "pipe", "pipe"],
  });

  const response = new Promise<Record<string, unknown>>((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => {
      reject(new Error("MCP initialize response timed out"));
    }, 10_000);

    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      const lineEnd = output.indexOf("\n");
      if (lineEnd === -1) return;

      clearTimeout(timeout);
      try {
        resolve(JSON.parse(output.slice(0, lineEnd)));
      } catch (error) {
        reject(error);
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

test("multiple stdio MCP servers complete initialize", async () => {
  const first = startServer();
  const second = startServer();

  try {
    const [firstResponse, secondResponse] = await Promise.all([
      first.response,
      second.response,
    ]);

    assert.equal(firstResponse.jsonrpc, "2.0");
    assert.equal(secondResponse.jsonrpc, "2.0");
    assert.equal((firstResponse.result as { serverInfo: { name: string } }).serverInfo.name, "CodeAtlas");
    assert.equal((secondResponse.result as { serverInfo: { name: string } }).serverInfo.name, "CodeAtlas");
  } finally {
    await Promise.all([stopServer(first.child), stopServer(second.child)]);
  }
});
