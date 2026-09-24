/**
 * Finds the closest preceding class by line number using binary search.
 * Searches for the class with the highest line number that is strictly less
 * than `funcLine`. Assumes `reversedClasses` is sorted in descending order
 * based on line numbers.
 * @param reversedClasses An array of classes that MUST be sorted descending by line number.
 * @param funcLine The line number of the function to compare against.
 */
export interface ClassReference {
  name: string;
  line: number;
}

export function binarySearchClosestPrecedingClass(
  reversedClasses: ClassReference[],
  funcLine: number
): ClassReference | undefined {
  if (!Array.isArray(reversedClasses) || reversedClasses.length === 0) return undefined;

  let startIdx = 0;
  let endIdx = reversedClasses.length - 1;
  let parentClass = undefined;

  while (startIdx <= endIdx) {
    // Unsigned right shift (>>> 1) efficiently computes Math.floor((startIdx + endIdx) / 2)
    // while protecting against potential 32-bit integer overflow.
    const middleIdx = (startIdx + endIdx) >>> 1;
    if (reversedClasses[middleIdx] && typeof reversedClasses[middleIdx].line === 'number' && reversedClasses[middleIdx].line < funcLine) {
      parentClass = reversedClasses[middleIdx];
      endIdx = middleIdx - 1;
    } else {
      startIdx = middleIdx + 1;
    }
  }
  return parentClass;
}

/**
 * ⚡ Bolt Optimization: Replace O(N log N) sorting + indexOf with an O(N) bucket-collection strategy
 * Takes an array of nodes and orders them by type based on a predefined priority sequence:
 * module, class, function, variable. Unrecognized types are pushed to the end.
 * Limits the final returned array to `max` items if specified.
 */
export function takeByPriority<T extends { type: string }>(nodes: T[], max?: number): T[] {
  const buckets: Record<string, T[]> = { module: [], class: [], function: [], variable: [] };
  const other: T[] = [];

  for (const n of nodes) {
    if (Object.hasOwn(buckets, n.type)) {
      buckets[n.type].push(n);
    } else {
      other.push(n);
    }
  }

  const sorted = [
    ...buckets.module,
    ...buckets.class,
    ...buckets.function,
    ...buckets.variable,
    ...other
  ];

  return max !== undefined ? sorted.slice(0, max) : sorted;
}

/**
 * ⚡ Bolt Optimization: Replace O(N) array allocation and slice with an early exit iterator
 * Converts an iterable into an array, pulling at most `max` items.
 */
export function takeFromIterable<T>(iterable: Iterable<T>, max: number): T[] {
  const result: T[] = [];
  for (const item of iterable) {
    if (result.length >= max) break;
    result.push(item);
  }
  return result;
}
