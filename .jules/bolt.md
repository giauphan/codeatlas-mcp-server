## Bolt Journal (Performance Optimizations)

**Goal:** Ensure the codebase is fast, efficient, and scalable.

### Learning
- 2023-11-20: Optimizing synchronous file I/O operations (`fs.readFileSync`) to asynchronous ones (`fs.promises.readFile`) in a tight loop is critical for unblocking the event loop, especially when dealing with hundreds or thousands of files. Using an asynchronous worker pool pattern strikes the perfect balance between high concurrency, early exit capability (to stop processing once a `maxRes` threshold is reached), and event loop responsiveness.
### 2024-05-24 - O(n²) Node Degree Calculation Bottleneck
**Learning:** Found a severe O(n²) performance bottleneck in `buildAnalysisResult` where calculating node layout sizes iterated through all links for every node (`this.nodes.forEach` wrapping `this.links.filter`). For large graphs (e.g., 5000 nodes, 20000 links), this takes thousands of milliseconds.
**Action:** Replace nested loops that calculate graph degrees (O(N * L)) with an O(N + L) approach by computing degrees in a single pass over links and storing them in a Map or object, then applying sizes in a single pass over nodes.
