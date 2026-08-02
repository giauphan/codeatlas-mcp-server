export function jaccardSimilarity(a: Set<string>, b: Set<string>): { similarity: number, intersectionSize: number, unionSize: number } {
  if (a.size > b.size) {
    return jaccardSimilarity(b, a);
  }

  let intersectionSize = 0;
  for (const t of a) {
    if (b.has(t)) {
      intersectionSize++;
    }
  }
  const unionSize = a.size + b.size - intersectionSize;
  const similarity = unionSize === 0 ? 0 : intersectionSize / unionSize;

  return { similarity, intersectionSize, unionSize };
}
