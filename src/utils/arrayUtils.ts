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
