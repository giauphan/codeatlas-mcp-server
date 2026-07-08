## Bolt Journal (Performance Optimizations)

**Goal:** Ensure the codebase is fast, efficient, and scalable.

### Learning
- 2023-11-20: Optimizing synchronous file I/O operations (`fs.readFileSync`) to asynchronous ones (`fs.promises.readFile`) in a tight loop is critical for unblocking the event loop, especially when dealing with hundreds or thousands of files. Using an asynchronous worker pool pattern strikes the perfect balance between high concurrency, early exit capability (to stop processing once a `maxRes` threshold is reached), and event loop responsiveness.
