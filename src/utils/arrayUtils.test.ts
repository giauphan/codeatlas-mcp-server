import { describe, it } from 'node:test';
import assert from 'node:assert';
import { binarySearchClosestPrecedingClass, takeByPriority } from './arrayUtils.js';

describe('binarySearchClosestPrecedingClass', () => {
  // Existing tests
});

describe('takeByPriority', () => {
  it('orders nodes by priority and pushes unknown types to the end', () => {
    const nodes = [
      { id: 1, type: 'unknown1' },
      { id: 2, type: 'class' },
      { id: 3, type: 'variable' },
      { id: 4, type: 'module' },
      { id: 5, type: 'function' },
      { id: 6, type: 'unknown2' }
    ];

    const result = takeByPriority(nodes);

    assert.deepStrictEqual(result.map(n => n.type), [
      'module',
      'class',
      'function',
      'variable',
      'unknown1',
      'unknown2'
    ]);
    // Verifies stable sort
    assert.deepStrictEqual(result.map(n => n.id), [4, 2, 5, 3, 1, 6]);
  });

  it('respects the max limit', () => {
    const nodes = [
      { id: 1, type: 'variable' },
      { id: 2, type: 'class' },
      { id: 3, type: 'module' },
      { id: 4, type: 'function' },
    ];

    const result = takeByPriority(nodes, 2);

    assert.deepStrictEqual(result.map(n => n.type), [
      'module',
      'class'
    ]);
    assert.deepStrictEqual(result.map(n => n.id), [3, 2]);
  });

  it('handles empty input gracefully', () => {
    const result = takeByPriority([]);
    assert.deepStrictEqual(result, []);
  });

  it('handles all unknown types correctly', () => {
    const nodes = [
      { id: 1, type: 'foo' },
      { id: 2, type: 'bar' }
    ];
    const result = takeByPriority(nodes);
    assert.deepStrictEqual(result.map(n => n.type), ['foo', 'bar']);
  });

  it('is safe against prototype pollution keys', () => {
    const nodes = [
      { id: 1, type: '__proto__' },
      { id: 2, type: 'constructor' },
      { id: 3, type: 'module' }
    ];
    const result = takeByPriority(nodes);
    // Should correctly categorize '__proto__' and 'constructor' as 'other' and put them at the end.
    assert.deepStrictEqual(result.map(n => n.type), ['module', '__proto__', 'constructor']);
  });
});
