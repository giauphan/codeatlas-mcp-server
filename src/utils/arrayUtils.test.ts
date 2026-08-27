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

  it('should throw an error in dev mode if array contains invalid elements and DEBUG is true', () => {
    const originalEnv = process.env.NODE_ENV;
    const originalDebug = process.env.DEBUG;
    process.env.NODE_ENV = 'development';
    process.env.DEBUG = 'true';

    const invalidClasses: any[] = [
      { name: 'ClassC', line: 100 },
      null,
      { name: 'ClassA', line: 10 }
    ];

    assert.throws(
      () => binarySearchClosestPrecedingClass(invalidClasses, 50),
      /\[arrayUtils\] Assertion failed: element at index 1 is null or has no valid line number/
    );

    process.env.NODE_ENV = originalEnv;
    process.env.DEBUG = originalDebug;
  });

  it('should throw an error in dev mode if array is not sorted descending and DEBUG is true', () => {
    const originalEnv = process.env.NODE_ENV;
    const originalDebug = process.env.DEBUG;
    process.env.NODE_ENV = 'development';
    process.env.DEBUG = 'true';

    const unsortedClasses = [
      { name: 'ClassC', line: 100 },
      { name: 'ClassA', line: 10 },
      { name: 'ClassB', line: 50 }
    ];

    assert.throws(
      () => binarySearchClosestPrecedingClass(unsortedClasses, 50),
      /\[arrayUtils\] Assertion failed: reversedClasses is not sorted descending at index 1/
    );

    process.env.NODE_ENV = originalEnv;
    process.env.DEBUG = originalDebug;
  });

  it('should return gracefully without crashing if an unsorted array is passed in production', () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    const unsortedClasses = [
      { name: 'ClassC', line: 100 },
      { name: 'ClassA', line: 10 },
      { name: 'ClassB', line: 50 }
    ];

    // In production, the dev-only assertions do not run. It should silently fail to find the correct element
    // and/or return a best-effort element without crashing the server.
    let didCrash = false;
    try {
      binarySearchClosestPrecedingClass(unsortedClasses, 75);
    } catch (e) {
      didCrash = true;
    }

    assert.strictEqual(didCrash, false, 'Function crashed on unsorted input in production');

    process.env.NODE_ENV = originalEnv;
  });
});
