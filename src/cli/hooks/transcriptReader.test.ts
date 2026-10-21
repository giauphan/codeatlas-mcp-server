import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import { readClaudeTranscript, validateClaudeTranscriptPath } from "./transcriptReader.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

test("only accepts exact Claude session JSONL beneath its encoded authorized project root", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "claude-transcript-")); roots.push(root);
  const projects = path.join(root, "projects");
  const cwd = path.join(root, "work", "repo");
  const encoded = cwd.replace(/[^A-Za-z0-9]/g, "-");
  const dir = path.join(projects, encoded);
  await mkdir(dir, { recursive: true });
  const transcript = path.join(dir, "session-1.jsonl");
  await writeFile(transcript, "");
  assert.equal(await validateClaudeTranscriptPath({ transcriptPath: transcript, sessionId: "session-1", cwd, projectsRoot: projects }), transcript);
  await assert.rejects(validateClaudeTranscriptPath({ transcriptPath: path.join(dir, "other.jsonl"), sessionId: "session-1", cwd, projectsRoot: projects }));
  await assert.rejects(validateClaudeTranscriptPath({ transcriptPath: path.join(projects, "elsewhere", "session-1.jsonl"), sessionId: "session-1", cwd, projectsRoot: projects }));
});

test("validates transcript paths for workspaces containing spaces and Unicode", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "claude-transcript-unicode-")); roots.push(root);
  const projects = path.join(root, "projects");
  const cwd = path.join(root, "work", "café workspace 東京");
  const encoded = cwd.replace(/[^A-Za-z0-9]/g, "-");
  const dir = path.join(projects, encoded);
  await mkdir(cwd, { recursive: true });
  await mkdir(dir, { recursive: true });
  const transcript = path.join(dir, "session-unicode.jsonl");
  await writeFile(transcript, "");
  assert.equal(await validateClaudeTranscriptPath({ transcriptPath: transcript, sessionId: "session-unicode", cwd, projectsRoot: projects }), transcript);
});

test("reads transcript rows from a descendant of an authorized workspace", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "claude-transcript-child-")); roots.push(root);
  const workspace = path.join(root, "workspace");
  const child = path.join(workspace, "packages", "api");
  const file = path.join(root, "session-child.jsonl");
  await mkdir(child, { recursive: true });
  await writeFile(file, `${JSON.stringify({ type: "user", sessionId: "session-child", cwd: child, message: { content: "remember child workspace" } })}\n`);
  const result = await readClaudeTranscript({ transcriptPath: file, sessionId: "session-child", projectId: "project_1", cursor: null, authorizedCwds: [workspace] });
  assert.deepEqual(result.events.map((event) => event.content), ["[USER]\nremember child workspace"]);
});

test("reads only complete text messages and derives stable IDs from source offsets", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "claude-transcript-")); roots.push(root);
  const file = path.join(root, "session-1.jsonl");
  const first = JSON.stringify({ type: "user", uuid: "u-1", message: { content: "remember this" } });
  const second = JSON.stringify({ type: "assistant", uuid: "a-1", message: { content: [{ type: "text", text: "answer" }, { type: "tool_use", name: "Bash", input: { command: "secret" } }] } });
  await writeFile(file, `${first}\n${JSON.stringify({ type: "progress", data: "ignore" })}\n${second}\n{"type":"user","message":`);
  const result = await readClaudeTranscript({ transcriptPath: file, sessionId: "session-1", projectId: "project_1", cursor: null });
  assert.equal(result.events.length, 2);
  assert.deepEqual(result.events.map((event) => event.content), ["[USER]\nremember this", "[ASSISTANT]\nanswer"]);
  assert.deepEqual(result.events.map((event) => event.actor_role), ["USER", "ASSISTANT"]);
  assert.equal(result.events[0]!.source_metadata.offset_unit, "byte");
  assert.match(result.events[0]!.event_id, /^claude_/);
  assert.equal(result.cursor.offset, Buffer.byteLength(`${first}\n${JSON.stringify({ type: "progress", data: "ignore" })}\n${second}\n`));
  const repeated = await readClaudeTranscript({ transcriptPath: file, sessionId: "session-1", projectId: "project_1", cursor: null });
  assert.deepEqual(result.events.map((event) => event.event_id), repeated.events.map((event) => event.event_id));
});

test("redacts long-lived and temporary AWS access key IDs before returning transcript events", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "claude-transcript-")); roots.push(root);
  const file = path.join(root, "session-aws.jsonl");
  const longLivedAwsAccessKeyId = ["AKIA", "EXAMPLEACCESS001"].join("");
  const temporaryAwsAccessKeyId = ["ASIA", "TESTACCESSKEY001"].join("");
  const content = `Decision: keep AWS identifiers out of memory; examples ${longLivedAwsAccessKeyId} and ${temporaryAwsAccessKeyId}.`;
  await writeFile(file, `${JSON.stringify({ type: "user", uuid: "aws", message: { content } })}\n`);

  const result = await readClaudeTranscript({ transcriptPath: file, sessionId: "session-aws", projectId: "project_1", cursor: null });

  assert.equal(result.events.length, 1);
  assert.doesNotMatch(result.events[0]!.content, new RegExp(`${longLivedAwsAccessKeyId}|${temporaryAwsAccessKeyId}`));
  assert.equal((result.events[0]!.content.match(/REDACTED_SECRET/g) ?? []).length, 2);
});

test("redacts AWS secret and session token fields in transcript text before returning events", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "claude-transcript-")); roots.push(root);
  const file = path.join(root, "session-aws-secret.jsonl");
  const content = 'AWS_SECRET_ACCESS_KEY=transcript-access-secret AWS_SESSION_TOKEN: transcript-session-secret';
  await writeFile(file, `${JSON.stringify({ type: "user", uuid: "aws-secret", message: { content } })}\n`);
  const result = await readClaudeTranscript({ transcriptPath: file, sessionId: "session-aws-secret", projectId: "project_1", cursor: null });
  assert.equal(result.events.length, 1);
  assert.doesNotMatch(result.events[0]!.content, /transcript-access-secret|transcript-session-secret/);
  assert.equal((result.events[0]!.content.match(/REDACTED_SECRET/g) ?? []).length, 2);
});

test("redacts quoted JSON AWS secret fields in transcript text before returning events", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "claude-transcript-")); roots.push(root);
  const file = path.join(root, "session-aws-json.jsonl");
  const content = '{"AWS_SECRET_ACCESS_KEY": "quoted-transcript-access", "AWS_SESSION_TOKEN":"quoted-transcript-session"}';
  await writeFile(file, `${JSON.stringify({ type: "user", uuid: "aws-json", message: { content } })}\n`);
  const result = await readClaudeTranscript({ transcriptPath: file, sessionId: "session-aws-json", projectId: "project_1", cursor: null });
  assert.equal(result.events.length, 1);
  assert.doesNotMatch(result.events[0]!.content, /quoted-transcript-access|quoted-transcript-session/);
});

test("restarts from zero after transcript truncation or inode rotation", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "claude-transcript-")); roots.push(root);
  const file = path.join(root, "session-1.jsonl");
  const row = (uuid: string, content: string) => JSON.stringify({ type: "user", uuid, message: { content } });
  await writeFile(file, `${row("old", "old line")}\n`);
  const old = await readClaudeTranscript({ transcriptPath: file, sessionId: "session-1", projectId: "project_1", cursor: null });
  await writeFile(file, `${row("new", "new line")}\n`);
  const next = await readClaudeTranscript({ transcriptPath: file, sessionId: "session-1", projectId: "project_1", cursor: old.cursor });
  assert.deepEqual(next.events.map((event) => event.content), ["[USER]\nnew line"]);
});

test("curates oversized evidence to a bounded head and tail without losing the outcome", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "claude-transcript-")); roots.push(root);
  const file = path.join(root, "session-1.jsonl");
  const longText = `${"early context ".repeat(2_000)}FINAL_NEGATED_DECISION=DO_NOT_ENABLE`;
  await writeFile(file, `${JSON.stringify({ type: "assistant", uuid: "large", message: { content: longText } })}\n`);
  const result = await readClaudeTranscript({ transcriptPath: file, sessionId: "session-1", projectId: "project_1", cursor: null });
  assert.equal(result.events.length, 1);
  assert.ok(result.events[0]!.content.length <= 1_800);
  assert.match(result.events[0]!.content, /output truncated/);
  assert.match(result.events[0]!.content, /FINAL_NEGATED_DECISION=DO_NOT_ENABLE$/);
});
