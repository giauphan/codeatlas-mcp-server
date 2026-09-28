import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { createSetFromMap } from '../../src/utils/set.js';

test('createSetFromMap', async (t) => {
  await t.test('handles normal array', () => {
    const input = [1, 2, 3];
    const result = createSetFromMap(input, x => x * 2);
    assert.deepEqual(Array.from(result), [2, 4, 6]);
  });

  await t.test('handles empty array', () => {
    const input: number[] = [];
    const result = createSetFromMap(input, x => x * 2);
    assert.equal(result.size, 0);
  });

  await t.test('deduplicates values', () => {
    const input = [1, 2, 3, 2, 1];
    const result = createSetFromMap(input, x => x * 10);
    assert.deepEqual(Array.from(result), [10, 20, 30]);
  });

  await t.test('works with strings and objects', () => {
    const input = [{ id: 'a' }, { id: 'b' }, { id: 'a' }];
    const result = createSetFromMap(input, obj => obj.id);
    assert.deepEqual(Array.from(result), ['a', 'b']);
  });
});
