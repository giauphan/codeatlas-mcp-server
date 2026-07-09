## Bolt Journal (Performance Optimizations)

**Goal:** Ensure the codebase is fast, efficient, and scalable.

### Learning
- 2023-11-20: Optimizing synchronous file I/O operations (`fs.readFileSync`) to asynchronous ones (`fs.promises.readFile`) in a tight loop is critical for unblocking the event loop, especially when dealing with hundreds or thousands of files. Using an asynchronous worker pool pattern strikes the perfect balance between high concurrency, early exit capability (to stop processing once a `maxRes` threshold is reached), and event loop responsiveness.
## 2024-07-09 - Fast Rejecting Search Misses
**Learning:** Checking for substrings using `content.split("\n")` directly iterates over strings character-by-character and generates an array of a large number of strings with overhead. On a full-text file search with high misses, using `String.prototype.split()` and looping is massively inefficient compared to evaluating `RegExp.prototype.test(content)`. Using `.toLowerCase()` before `includes(q)` incurs a massive O(N) memory allocation and copy for the entire file which scales terribly.
**Action:** Always pre-compile a regex outside a hot-path/loop and use `.test(content)` to execute a "fast reject" operation before performing expensive string manipulation operations like `split()` on full files. Avoid using `.toLowerCase()` on large files for case-insensitive matching; use `RegExp` with the `i` flag instead.
