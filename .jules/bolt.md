## 2024-03-20 - [O(N * L) to O(N + L) Optimization in Parser]
**Learning:** Found nested loops inside `filter` operations over large AST Node and Link arrays. Calculating relationships inside an array filter creates severe hidden O(N*L) bottlenecks.
**Action:** Always extract relationship checks outside of node iteration loops. Build lookup maps in O(L) time first, then query them in O(N) time.
