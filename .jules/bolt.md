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

## 2026-07-25 - [Performance improvement] Regex and early exit for node arrays
**Learning:** Chaining `.filter(n => n.label.toLowerCase().includes(query)).slice(0, N)` on extremely large sets of graph nodes is incredibly inefficient as it enforces an O(N) traversal of all nodes and creates hundreds of thousands of intermediate string allocations from `toLowerCase()`. Using a regex to achieve case-insensitivity (`new RegExp(query, 'i')`) along with a traditional `for` loop that performs an early exit when `N` elements are found, turns this into a highly optimized O(1) best-case operation with virtually no string GC overhead.
**Action:** When filtering a large collection but only needing a limited subset of results, avoid chained `.filter().slice()`. Instead, use standard control structures (`for` / `break`) to exit as soon as the target slice size is reached. Always prefer precompiled regex over mapping properties to lower case during such iterations.

## 2024-05-19 - CodeAnalyzer AST Parsing Graph Build Bottleneck
**Learning:** Found an O(N*E) bottleneck in `buildAnalysisResult` where calculating degree involved repeatedly filtering `this.links` array for each node.
**Action:** Replace `this.links.filter` with a single `nodeDegrees` Map that tallies edges across `this.links` in O(E), improving huge graph generation times significantly. Also optimized `entityCounts` grouping to O(N) by collapsing multiple `Array.from().filter()` calls into a single loop.
## 2026-07-26 - [Performance improvement] Array.find inside Array.map
**Learning:** Found an O(L*N) bottleneck in `mcpServer.ts` (exporting artifact summary) and `e2e.test.ts` where `Array.prototype.find()` was called inside `Array.prototype.map()` for every graph link to find its source and target nodes. This is extremely slow for large AST graphs.
**Action:** Always precompute a lookup Map (e.g., `Map<string, string>`) in O(N) time before the loop, and use `.get()` to look up elements in O(1) time. Also avoid chained `.filter().map().slice()` by combining them into a single early-exit `for` loop.
## 2026-07-26 - [Performance improvement] Optimized O(N*E) generateAIInsights
**Learning:** Filtering a links array for every node using `graph.links.filter` creates an O(N*E) bottleneck when checking relationships (like finding modules with many functions).
**Action:** When filtering or counting relationships between nodes, avoid nesting a links filter inside a nodes loop. Instead, do a single O(E) pass over the links array to precompute the required counts in a Map, enabling O(1) lookups during the subsequent O(N) nodes loop.
## 2025-07-29 - [Performance improvement] Optimized O(N*L) array some during node filtering
**Learning:** Checking for node connections by using `nodes.filter` and inside it `links.some` is an O(N*L) operation which leads to a severe performance bottleneck for large graphs. Precomputing a Set with all `source` and `target` links takes O(L) space and time and makes the lookup O(1), bringing the total time complexity to O(N+L).
**Action:** When filtering or counting relationships between nodes, avoid nesting a links `some` or `filter` or `find` inside a nodes loop. Instead, do a single O(L) pass over the links array to precompute a `Set` or `Map`, enabling O(1) lookups during the subsequent O(N) nodes loop.
## 2025-07-29 - [Performance improvement] Optimized O(N) array filtering and mapping
**Learning:** Chained array methods like `.filter().map()` or `.filter().slice().map()` on large sets of graph nodes are inefficient. They enforce multiple O(N) traversals of all nodes and create intermediate array allocations.
**Action:** When filtering and mapping a large collection, use a single `for...of` loop. Apply filter conditions inside the loop and `push` to the result array. Implement early exit conditions (e.g. `count < limit`) to avoid iterating the entire collection unnecessarily when a limited slice is desired.

## 2025-07-29 - [Performance improvement] Optimized O(E) double link traversal
**Learning:** Traversing the same `links` array multiple times (e.g. using `links.forEach()` to count outgoing connections, then `links.forEach()` again to count incoming connections) wastes execution time.
**Action:** When calculating multiple distinct graph metrics from links, combine them into a single O(E) loop that populates multiple Maps simultaneously.

## 2026-07-26 - [Performance improvement] Optimized O(N*L) link filtering inside node mapping
**Learning:** Checking for node connections by using `nodes.map` and inside it `links.filter` is an O(N*L) operation which leads to a severe performance bottleneck for large graphs. Precomputing Maps for incoming/outgoing links by iterating over the `links` array once takes O(L) time and makes the lookup O(1), bringing the total time complexity to O(N+L).
**Action:** When mapping relationships for a subset of nodes, avoid nesting a links `filter` inside a nodes `map`. Instead, do a single O(L) pass over the links array to precompute a `Map`, enabling O(1) lookups during the subsequent O(N) nodes mapping.
