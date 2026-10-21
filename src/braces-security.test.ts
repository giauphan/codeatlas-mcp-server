import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const braces = require('braces');

function nestedBraces(depth: number): string {
  return `${'{'.repeat(depth)}x${'}'.repeat(depth)}`;
}

test('braces rejects nesting beyond the default depth limit', () => {
  assert.throws(() => braces.parse(nestedBraces(101)), { name: 'SyntaxError' });
});

test('braces honors a caller-supplied lower depth limit', () => {
  assert.throws(() => braces.parse(nestedBraces(5), { maxDepth: 4 }), {
    name: 'SyntaxError',
  });
});

test('compile, expand, and stringify guard nested AST traversal', () => {
  const ast = braces.parse(nestedBraces(4));

  for (const method of ['compile', 'expand', 'stringify']) {
    assert.throws(() => braces[method](ast, { maxDepth: 3 }), {
      name: 'RangeError',
    });
  }
});

test('braces retains its normal expansion and regex compilation API', () => {
  assert.deepEqual(braces.expand('file-{a,b}.txt'), ['file-a.txt', 'file-b.txt']);
  assert.deepEqual(braces('file-{a,b}.txt'), ['file-(a|b).txt']);
  assert.equal(typeof braces.parse, 'function');
  assert.equal(typeof braces.compile, 'function');
  assert.equal(typeof braces.stringify, 'function');
});

test('micromatch resolves the same guarded braces implementation', () => {
  const canonicalFork = require('@dieub/braces-depth-guard');
  const micromatchEntry = require.resolve('micromatch');
  const micromatchRequire = createRequire(micromatchEntry);
  const bracesFromMicromatch = micromatchRequire('braces');

  assert.equal(
    require.resolve('braces', { paths: [dirname(micromatchEntry)] }),
    require.resolve('braces'),
  );
  assert.equal(bracesFromMicromatch, braces);
  assert.equal(braces, canonicalFork);
});

test('semantic-release commit analysis still produces a configured patch release', async () => {
  const analyzerModuleName = '@semantic-release/commit-analyzer';
  const { analyzeCommits } = await import(analyzerModuleName);
  const releaseType = await analyzeCommits(
    { releaseRules: [{ type: 'fix', release: 'patch' }] },
    {
      commits: [{ hash: 'test', message: 'fix: exercise release analyzer' }],
      cwd: process.cwd(),
      logger: { log() {} },
    },
  );

  assert.equal(releaseType, 'patch');
});

test('vendored fork archive matches its reviewed SHA-256', () => {
  const archive = readFileSync(new URL('../vendor/original-unmodified-fork.tgz', import.meta.url));
  const digest = createHash('sha256').update(archive).digest('hex');

  assert.equal(
    digest,
    'bfddf5527888add524fb533818cd5c56ed66e9d0454705e1a4ef002de9905227',
  );
});
