/**
 * Finds the closest preceding class by line number using binary search.
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
  if (!reversedClasses || reversedClasses.length === 0) return undefined;

  // Dev Assertion: Ensure the array is properly sorted descending by line number in development.
  if (process.env.NODE_ENV !== 'production' && reversedClasses.length > 1) {
    for (let i = 0; i < reversedClasses.length - 1; i++) {
      if (reversedClasses[i].line < reversedClasses[i + 1].line) {
        throw new Error(`[arrayUtils] Assertion failed: reversedClasses is not sorted descending at index ${i}`);
      }
    }
  }

  let startIdx = 0;
  let endIdx = reversedClasses.length - 1;
  let parentClass = undefined;

  while (startIdx <= endIdx) {
    const middleIdx = (startIdx + endIdx) >>> 1;
    // The array is reversed, meaning it's sorted descending by line number.
    // We want the class with the largest line number that is strictly less than funcLine.
    // If middleIdx line is < funcLine, it's a candidate. We then search the left half
    // (smaller indices = larger line numbers) to see if we can find a closer one.
    if (reversedClasses[middleIdx] && typeof reversedClasses[middleIdx].line === 'number' && reversedClasses[middleIdx].line < funcLine) {
      parentClass = reversedClasses[middleIdx];
      endIdx = middleIdx - 1;
    } else {
      // The line number is >= funcLine. We need a smaller line number,
      // which corresponds to larger indices in the reversed array.
      startIdx = middleIdx + 1;
    }
  }
  return parentClass;
}
