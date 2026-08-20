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
## 2026-08-02 - [Performance improvement] Optimized O(N²) Jaccard Similarity Calculation
**Learning:** When computing Set sizes (like intersection or Jaccard similarity) inside tight loops (e.g., O(N²)), avoid using spread syntax and intermediate array/Set allocations like `new Set([...a].filter(x => b.has(x)))`. Instead, manually iterate through one set and count matches to calculate `intersectionSize`, then mathematically compute `unionSize = a.size + b.size - intersectionSize` to prevent severe GC (Garbage Collection) pressure and memory spikes.
**Action:** When computing Set operations where only the resulting size is needed, manually count matches instead of allocating intermediate Sets or arrays.

## 2026-08-01 - [O(F*L) Array Filtering Bottleneck in Graph Construction]
**Learning:** In the `buildChunkedResult` method, filtering the links array for each folder created an O(F*L) bottleneck, causing significant performance degradation for large graphs. The issue arose because `array.filter` iterated over all links for every mapped folder just to find the links internal to that folder.
**Action:** When categorizing or partitioning a large array of relationships (like edges in a graph) into multiple buckets, prefer initializing the buckets and executing a single O(N) loop over the items to distribute them, rather than running `filter` for each bucket. This single-pass distribution avoids massive loop amplification.

## 2026-07-29 - [Performance improvement] Optimized Set Intersection in Tight Loops
**Learning:** When calculating Set intersections or Jaccard similarity inside a nested O(N^2) loop, doing `new Set([...a].filter(x => b.has(x)))` creates arrays, spreads them, filters them, and builds a new Set on every iteration. This causes immense Garbage Collection pressure and performance degradation.
**Action:** When only sizes are needed (e.g. for Jaccard similarity `intersection / union`), avoid creating Sets entirely. Instead, iterate over the smaller set with a simple `for...of` loop, count the matches to get `intersectionSize`, and mathematically calculate `unionSize = a.size + b.size - intersectionSize`.

## 2025-07-30 - [Performance improvement] Optimized O(N*E) array filtering in loops and O(N^2) indexOf deduplication
**Learning:** During analysis of the `call_graph` component inside `mcpServer.ts`, an O(N*E) logic pattern was found within the diagram's order resolving logic where `dedupLinks` (Array of size E) was getting filtered repeatedly per node (N instances). In addition, O(N²) issues were discovered with `.filter((val, i, arr) => arr.indexOf(val) === i)` logic when generating execution/reading orders.
**Action:** When filtering relationships based on node IDs in a loop, precompute a `Map<string, string[]>` of targets / sources to avoid `O(N*E)` operation. When deduplicating arrays, avoid `.indexOf(val) === i` on `.filter()` over large lists. Instead, utilize `Set` instances with loops to achieve `O(N)` scaling with `O(1)` time checks.

## 2025-07-29 - [Performance improvement] Optimized O(N) array filtering and mapping
**Learning:** Chained array methods like `.filter().map()` or `.filter().slice().map()` on large sets of graph nodes are inefficient. They enforce multiple O(N) traversals of all nodes and create intermediate array allocations.
**Action:** When filtering and mapping a large collection, use a single `for...of` loop. Apply filter conditions inside the loop and `push` to the result array. Implement early exit conditions (e.g. `count < limit`) to avoid iterating the entire collection unnecessarily when a limited slice is desired.

## 2025-07-29 - [Performance improvement] Optimized O(E) double link traversal
**Learning:** Traversing the same `links` array multiple times (e.g. using `links.forEach()` to count outgoing connections, then `links.forEach()` again to count incoming connections) wastes execution time.
**Action:** When calculating multiple distinct graph metrics from links, combine them into a single O(E) loop that populates multiple Maps simultaneously.

## 2026-07-26 - [Performance improvement] Optimized O(N*L) link filtering inside node mapping
**Learning:** Checking for node connections by using `nodes.map` and inside it `links.filter` is an O(N*L) operation which leads to a severe performance bottleneck for large graphs. Precomputing Maps for incoming/outgoing links by iterating over the `links` array once takes O(L) time and makes the lookup O(1), bringing the total time complexity to O(N+L).
**Action:** When mapping relationships for a subset of nodes, avoid nesting a links `filter` inside a nodes `map`. Instead, do a single O(L) pass over the links array to precompute a `Map`, enabling O(1) lookups during the subsequent O(N) nodes mapping.

## 2026-07-30 - [Performance improvement] Optimized O(N^2) Set intersections
**Learning:** Checking Set intersection and Jaccard similarity inside an O(N^2) loop using `new Set([...a].filter(x => b.has(x)))` creates massive garbage collection pressure by constantly allocating new temporary Arrays and Sets. You can calculate the intersection size and union size for Jaccard similarity without allocating anything by iterating through one set and counting the matches (`if (b.has(x)) intersectionSize++`), then computing `unionSize = a.size + b.size - intersectionSize`. If the similarity threshold is very low and the loop body executes for many pairs, this change yields proportionally more benefit since the inner loop executes more often.
**Action:** When computing Set sizes for similarity algorithms inside tight loops, avoid creating new Sets or using spread syntax (`...`). Instead, manually iterate and maintain counter variables to prevent memory spikes.


## 2024-05-18 - Optimize sync_skills_inventory I/O
**Learning:** Checking `fs.existsSync` inside tight loops before an operation (like `fs.readdirSync` or `fs.readFileSync`) creates redundant system calls and introduces a minor TOCTOU race condition. Also, iterating over `fs.readdirSync` requires explicit `.statSync` or `.isDirectory()` to filter entries, but using `{ withFileTypes: true }` avoids additional file stat lookups.
**Action:** Used the EAFP (Easier to Ask for Forgiveness than Permission) pattern by wrapping `fs.readFileSync` in a `try/catch` and removing `fs.existsSync`. Updated `fs.readdirSync` to use `{ withFileTypes: true }` to filter out non-directories without needing extra stat calls.
## 2024-05-18 - Prevent event loop blocking in file search loops
**Learning:** Using synchronous I/O (`fs.readFileSync`) inside loops when handling concurrent server requests can severely block the Node.js event loop, degrading server concurrency and latency.
**Action:** Replaced synchronous `fs.readFileSync` with asynchronous `await fs.promises.readFile` inside the `code_search` loop in `src/presentation/mcpServer.ts`. This allows the event loop to yield execution during I/O wait times, maintaining sequential memory bounds while significantly improving concurrent responsiveness.

## 2024-05-20 - [Performance improvement] Optimized O(N) array filtering and mapping in MCP tools
**Learning:** Chained array methods like `.filter().filter().slice()` and `.filter().map()` are frequently used but introduce significant performance bottlenecks, particularly when dealing with large datasets like AST nodes or graph edges. Each chained call forces a full O(N) traversal and creates intermediate array allocations, dramatically increasing CPU usage and garbage collection overhead.
**Action:** When filtering, mapping, and slicing large collections, prefer a single `for...of` loop. Apply filter conditions within the loop, manually manage the result collections by `push`ing to arrays, and implement early exit conditions (`if (results.length >= limit) break;`) to avoid unnecessary iterations over the entire dataset.

## 2024-05-18 - Replacing chained array methods with single for...of loop for graph datasets
**Learning:** In graph analysis contexts with large datasets (e.g. 200,000+ links), chaining multiple `array.filter().filter().map()` operations creates a significant performance bottleneck due to O(M * N) array iterations and intermediate array allocations in memory.
**Action:** When filtering, validating endpoints, or deduplicating elements in large arrays (like nodes or edges), always combine the logic into a single `for...of` loop with early `continue` exclusions and a `Set` for deduplication. This collapses multiple O(N) operations into a single O(N) pass, saving memory and CPU cycles.

## 2024-05-24 - Hoisting Global Regular Expressions Safely
**Learning:** Moving a global regular expression (`/g`) outside a loop is a common performance optimization to avoid recompilation overhead. However, when doing so, it is critical to reset the regex's internal state (specifically the `lastIndex` property) before reusing it within the loop. Failure to reset `lastIndex` causes the regex to continue matching from where it left off in the previous string, leading to missed matches or incorrect tokenization across different strings.
**Action:** When hoisting global regexes out of loops (e.g., in `mcpServer.ts`), always explicitly set `regex.lastIndex = 0` immediately before the loop or matching block that reuses it.

## 2026-08-04 - [Performance improvement] Optimized O(E) double link traversal in AI Insights
**Learning:** In `src/analyzer/parser.ts`, the `generateAIInsights` method iterated over `graph.links` twice in separate `for...of` loops to compute module function counts and module dependencies. This forced multiple full passes over the entire relationship dataset, increasing execution time and CPU overhead on large graphs.
**Action:** When gathering multiple independent metrics from a large collection (like links in a graph), always combine them into a single pass using one `for...of` loop. Initialize the necessary `Map`s beforehand and populate them concurrently within the loop body.

## 2026-08-16 - [Performance improvement] Optimized O(N) multi-pass metric aggregation
**Learning:** During analysis of the `index_coverage` tool in `src/presentation/mcpServer.ts`, it was discovered that generating project coverage statistics involved iterating over the `nodes` array 4 separate times (one `.filter()` and three separate `for...of` loops) to calculate valid node subsets, type distributions, file distributions, and coverage percentages.
**Action:** When calculating multiple distinct aggregates over a single large dataset (like the `nodes` array), replace chained `.filter()` calls and multiple iterations with a single, consolidated `for...of` loop. Accumulate all required metrics within the same loop to drastically reduce iterations, saving significant O(N) traversal time and intermediate array allocations.

## 2025-07-31 - [Performance improvement] Optimized O(N) Array filtering with early exit over large directories
**Learning:** In contexts where a directory contains thousands of files (e.g. `/proc`), using `.filter(regex).slice(0, N)` iterates and evaluates the regex against every single item in the entire directory list. This creates massive overhead when only the first few items are needed.
**Action:** Replace `array.filter(condition).slice(0, limit)` over large arrays with a single `for...of` loop that `push`es matches and immediately `break`s once the limit is reached.
