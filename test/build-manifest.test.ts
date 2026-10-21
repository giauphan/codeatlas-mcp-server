import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, copyFileSync, symlinkSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { verifyBuildManifest } from '../scripts/build-manifest.js';

const scripts = path.resolve(import.meta.dirname, '../scripts');
function fixture(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'codeatlas-build-manifest-'));
  mkdirSync(path.join(root, 'src/cli/hooks'), { recursive: true });
  mkdirSync(path.join(root, 'dist/src/cli/hooks'), { recursive: true });
  mkdirSync(path.join(root, 'scripts'), { recursive: true });
  for (const file of ['claude-hook-settings.js', 'setup-hooks.js', 'validate-hooks.js']) copyFileSync(path.join(scripts, file), path.join(root, 'scripts', file));
  writeFileSync(path.join(root, 'package.json'), '{"version":"test"}');
  writeFileSync(path.join(root, 'index.ts'), 'export const version: string = "first";');
  writeFileSync(path.join(root, 'dist/index.js'), 'export const version = "first";');
  writeFileSync(path.join(root, 'src/cli/hooks/brain-save.sh'), '#!/bin/sh\nexit 0\n');
  writeFileSync(path.join(root, 'src/cli/hooks/decoder.ts'), 'export const decoded = true;');
  writeFileSync(path.join(root, 'dist/src/cli/hooks/decoder.js'), 'export const decoded = true;');
  return root;
}
function run(script: string, cwd: string): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, [path.join(scripts, script)], { cwd, encoding: 'utf8' });
}

test('release validation rejects source changed after compilation', () => {
  const root = fixture();
  try {
    assert.equal(run('copy-hooks.js', root).status, 0);
    assert.equal(run('verify-build.js', root).status, 0);
    writeFileSync(path.join(root, 'index.ts'), 'export const version: string = "second";');
    assert.notEqual(run('verify-build.js', root).status, 0, 'Stale JS must block release');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('release validation rejects compiled output changed after build manifest', () => {
  const root = fixture();
  try {
    assert.equal(run('copy-hooks.js', root).status, 0);
    writeFileSync(path.join(root, 'dist/index.js'), 'export const version = "tampered";');
    assert.notEqual(run('verify-build.js', root).status, 0, 'Modified JS must block release');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('release validation does not follow symlinks outside the build tree', () => {
  const root = fixture();
  const outside = path.join(root, 'outside.js');
  writeFileSync(outside, 'export const secret = true;');
  try {
    symlinkSync(outside, path.join(root, 'dist', 'outside.js'));
    assert.equal(run('copy-hooks.js', root).status, 0);
    const manifest = JSON.parse(readFileSync(path.join(root, 'dist', 'build-manifest.json'), 'utf8'));
    assert.equal(Object.hasOwn(manifest.artifact_sha256, 'outside.js'), false);
    assert.equal(run('verify-build.js', root).status, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('release validation rejects a dist argument that escapes its root', () => {
  const root = fixture();
  const outside = path.join(path.dirname(root), 'outside-build');
  mkdirSync(outside, { recursive: true });
  writeFileSync(path.join(outside, 'build-manifest.json'), '{}');
  try {
    assert.throws(() => verifyBuildManifest('../outside-build', root), /outside build root/);
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); }
});

test('hook packaging copies runtime assets and keeps TypeScript sources out of dist', () => {
  const root = fixture();
  try {
    assert.equal(run('copy-hooks.js', root).status, 0);
    assert.ok(existsSync(path.join(root, 'dist/src/cli/hooks/brain-save.sh')));
    assert.ok(existsSync(path.join(root, 'dist/src/cli/hooks/decoder.js')));
    assert.equal(existsSync(path.join(root, 'dist/src/cli/hooks/decoder.ts')), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
