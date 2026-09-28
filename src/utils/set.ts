/**
 * Utility to create a Set from a mapped array without allocating an intermediate array.
 * This reduces temporary array allocations and garbage collection overhead in hot paths
 * handling large datasets.
 *
 *
 * @example
 * // Instead of: new Set(nodes.map(n => n.id))
 * // Use: createSetFromMap(nodes, n => n.id)
 *
 * @param items The items to iterate over
 * @param mapFn The mapping function
 * @returns A Set containing the mapped items
 */
export function createSetFromMap<T, U>(items: Iterable<T>, mapFn: (item: T) => U): Set<U> {
  const set = new Set<U>();
  for (const item of items) {
    set.add(mapFn(item));
  }
  return set;
}
