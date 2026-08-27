import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { binarySearchClosestPrecedingClass } from './arrayUtils.js';

describe('binarySearchClosestPrecedingClass', () => {
  it('should find the closest preceding class', () => {
    // Array sorted descending by line number
    const reversedClasses = [
      { name: 'ClassC', line: 100 },
      { name: 'ClassB', line: 50 },
      { name: 'ClassA', line: 10 }
    ];

    const result = binarySearchClosestPrecedingClass(reversedClasses, 75);
    assert.strictEqual(result?.name, 'ClassB');
    assert.strictEqual(result?.line, 50);
  });

  it('should return undefined if no class precedes the function', () => {
    const reversedClasses = [
      { name: 'ClassC', line: 100 },
      { name: 'ClassB', line: 50 },
      { name: 'ClassA', line: 10 }
    ];

    const result = binarySearchClosestPrecedingClass(reversedClasses, 5);
    assert.strictEqual(result, undefined);
  });

  it('should return undefined for empty array', () => {
    const result = binarySearchClosestPrecedingClass([], 50);
    assert.strictEqual(result, undefined);
  });
});
