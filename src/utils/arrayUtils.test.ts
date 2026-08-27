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

  it('should warn in dev mode if array contains invalid elements and DEBUG is true', () => {
    const originalEnv = process.env.NODE_ENV;
    const originalDebug = process.env.DEBUG;
    process.env.NODE_ENV = 'development';
    process.env.DEBUG = 'true';

    let warningLogged = false;
    const originalWarn = console.warn;
    console.warn = (msg) => {
      if (msg.includes('null or has no valid line number')) warningLogged = true;
    };

    const invalidClasses: any[] = [
      { name: 'ClassC', line: 100 },
      null,
      { name: 'ClassA', line: 10 }
    ];

    binarySearchClosestPrecedingClass(invalidClasses, 50);

    assert.strictEqual(warningLogged, true);

    console.warn = originalWarn;
    process.env.NODE_ENV = originalEnv;
    process.env.DEBUG = originalDebug;
  });

  it('should warn in dev mode if array is not sorted descending and DEBUG is true', () => {
    const originalEnv = process.env.NODE_ENV;
    const originalDebug = process.env.DEBUG;
    process.env.NODE_ENV = 'development';
    process.env.DEBUG = 'true';

    let warningLogged = false;
    const originalWarn = console.warn;
    console.warn = (msg) => {
      if (msg.includes('not sorted descending')) warningLogged = true;
    };

    const unsortedClasses = [
      { name: 'ClassC', line: 100 },
      { name: 'ClassA', line: 10 },
      { name: 'ClassB', line: 50 }
    ];

    binarySearchClosestPrecedingClass(unsortedClasses, 50);

    assert.strictEqual(warningLogged, true);

    console.warn = originalWarn;
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

  it('should test binary search across boundary conditions (smallest and largest elements)', () => {
    const reversedClasses = [
      { name: 'ClassD', line: 100 },
      { name: 'ClassC', line: 75 },
      { name: 'ClassB', line: 50 },
      { name: 'ClassA', line: 25 }
    ];

    // Boundary condition: function line is strictly greater than the largest class line
    const resultLargest = binarySearchClosestPrecedingClass(reversedClasses, 200);
    assert.strictEqual(resultLargest?.name, 'ClassD');

    // Boundary condition: function line is exactly equal to the largest class line
    // (should return the next one down, strictly preceding)
    const resultEqualLargest = binarySearchClosestPrecedingClass(reversedClasses, 100);
    assert.strictEqual(resultEqualLargest?.name, 'ClassC');

    // Boundary condition: function line is strictly less than the smallest class line
    const resultSmallest = binarySearchClosestPrecedingClass(reversedClasses, 10);
    assert.strictEqual(resultSmallest, undefined);
  });
});
