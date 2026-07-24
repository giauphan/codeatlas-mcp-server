## 2025-07-13 - [Performance improvement] Speed up file discovery in CodeAnalyzer by using fs.readdirSync withFileTypes
**Learning:** Using `fs.readdirSync(dir)` and then calling `fs.statSync()` for each file requires a synchronous disk I/O call for every single file. Node.js provides `fs.readdirSync(dir, { withFileTypes: true })`, which returns `fs.Dirent` objects and already includes the file type without extra I/O calls. This scales dramatically better for large trees.
**Action:** When performing recursive directory traversal or reading many files, always prefer `fs.readdir` or `fs.readdirSync` with `{ withFileTypes: true }` to avoid the blocking overhead of `fs.stat` or `fs.statSync`. Always ensure that `entry.isSymbolicLink()` is handled, as `fs.Dirent` will return false for `isDirectory()` on symlinks.
## 2025-07-13 - [Performance improvement] Speed up code_search with early Regex check
**Learning:** When performing full-text searches across many large files, calling `content.toLowerCase()` on the entire file contents to perform an `.includes()` check causes massive memory spikes due to allocating new strings. Using `new RegExp(escapedQuery, 'i')` allows for a case-insensitive existence check without duplicating the entire string memory, providing both speed and memory efficiency.
**Action:** When filtering or performing early exit checks on large text blocks, prefer case-insensitive regex checks over converting the entire text to lowercase, to avoid excessive memory allocation and GC overhead.
## 2025-07-15 - [Performance improvement] Concurrent project scanning in enterprise vulnerabilities
**Learning:** Sequential loops awaiting long-running I/O or network calls (`await loadAnalysisAsync`, `await SecurityScanner.aiScan`) bottleneck multi-project scans. Using `Promise.all` with a mapping function parallelizes the execution, vastly improving throughput.
**Action:** When iterating over multiple independent items that perform async I/O or network requests, convert sequential `for...of` loops with `await` into a concurrent `Promise.all` map, provided there are no state dependencies between loop iterations.
## 2026-07-15 - Bolt: Parallelize project discovery
**What:** The `scanForCodeatlasProjectsAsync` function in `src/services/projectService.ts` was sequentially calling `fs.promises.readdir` and `fs.existsSync`/`fileExists` for subdirectory project discovery. I updated it to use `Promise.allSettled` with `.map` and inner `try-catch` blocks to safely check file existences concurrently without short-circuiting, and added sorting to ensure deterministic output.
**Why:** Disk I/O bound nested loops are very inefficient, particularly when traversing potentially thousands of directories.
**Impact:** Benchmark speedups show ~3x performance improvement. Specifically checking 2500 directories improved from 534ms to 173ms on local testing hardware.
**Measurement:** Added custom `tsx` based scripts (`benchmark_scan.ts` and `benchmark_scan_opt.ts`) to synthesize an artificial tree with thousands of directories and compared total times before and after changes.
## 2025-07-28 - [Performance improvement] Regex testing vs String manipulation
**Learning:** Checking character matching (like finding non-lowercase alphabetical characters) by applying string allocations via `.toLowerCase().replace()` and comparing to the original is incredibly slow. Using a regular expression `.test()` without memory allocation provides almost 3x performance speedups inside parser loops.
**Action:** When filtering or performing early exit checks on large text blocks or frequently inside loops, prefer case-insensitive regex checks over converting strings with `toLowerCase()`, to avoid excessive memory allocation and GC overhead.

## 2025-07-28 - [Performance improvement] fs.promises.readdir withFileTypes
**Learning:** When asynchronously discovering projects or reading large directories, iterating `fs.promises.readdir` results and mapping an `fs.promises.stat` on each creates enormous blocking async loads. Using `fs.promises.readdir` with `withFileTypes: true` yields `Dirent` instances directly, reducing disk I/O significantly.
**Action:** In directory traversal operations (sync or async), always pass `{ withFileTypes: true }` to `readdir` to prevent mapping massive arrays of `stat` operations. Remember to manually handle `symlinks` (`isSymbolicLink`) to ensure correctness.
## 2025-07-28 - [Performance improvement] Avoid massive intermediate arrays via nodes.map(...)
**Learning:** Using `new Map(nodes.map(n => [n.id, n]))` creates a gigantic intermediate array of tuples proportional to the size of `nodes` (which can be tens of thousands of items in AST graph representations). This leads to massive, immediate memory allocations and aggressive GC spikes. Utilizing simple `for`-loops that explicitly invoke `map.set()` completely circumvents this overhead and operates in O(1) extra space.
**Action:** When converting large arrays to Maps or Sets, use an explicit `for`-loop iteration strategy rather than using chained `.map()` operations to prevent explosive memory footprints.

## 2026-07-21 - [Performance improvement] fs.readdirSync withFileTypes returning Map of dirents
**Learning:** During import path resolution logic across thousands of files, caching directory contents is crucial. Previously, we only cached a `Set<string>` of filenames via `fs.readdirSync`. This required a subsequent blocking `fs.statSync()` call per matched file to determine if the path was a directory or file. By utilizing `fs.readdirSync(dir, { withFileTypes: true })` and caching the `Map<string, fs.Dirent>`, we can completely bypass the synchronous disk I/O `statSync` (falling back only for broken symlinks), giving massive performance improvements in AST resolution paths.
**Action:** Always prefer retrieving and caching `fs.Dirent` when performing recursive or iterative file resolution, instead of simply mapping names to perform `fs.statSync` later.

## 2026-07-24 - Precomputed Lowercase for Tight Loops
**Learning:** In tight loops like directory traversal or string matching, repeated calls to `.toLowerCase()` on the same strings create many intermediate string allocations, causing high garbage collection overhead and degraded performance. Using `a.toLowerCase() !== b.toLowerCase()` inside a nested loop multiplies this overhead. Furthermore, be careful using `length` as an early exit for lowercased Unicode strings, as they can change length.
**Action:** When a string needs case-insensitive comparison repeatedly:
1. Extract the `.toLowerCase()` call outside the loop for the invariant string (e.g. `const lowerParts = parts.map(p => p.toLowerCase())`).
2. Inside the loop, perform a fast exact-case check first (`if (a !== b)`). This skips string allocation and extra comparison entirely when they match exactly (the fast path).
3. Be cautious with length checks on lowercased characters (some Unicode characters change length when lowercased).
4. Only use `.toLowerCase()` on the inner loop variable if necessary, or pre-compute it if possible.
