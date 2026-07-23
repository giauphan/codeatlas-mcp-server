1. Address the PR review comment.
    - The reviewer suggests pre-computing the lowercase versions of `normFileParts` to completely eliminate `.toLowerCase()` calls from the inner loop.
    - We will modify `findDirMatchingNormalized` to map `normFileParts` to `normFilePartsLower` right after it is created.
    - Update the `partB.toLowerCase()` check to use the precomputed `normFilePartsLower[j]`.
2. Run tests to ensure no regressions.
3. Reply to the PR comment and submit the PR on branch `bolt-opt-tolowercase`.
