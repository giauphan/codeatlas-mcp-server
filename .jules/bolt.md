## 2024-05-24 - fs.readdirSync vs fs.statSync
**Learning:** For deep file traversal, calling `fs.statSync` on every file is extremely expensive due to I/O overhead. Using `fs.readdirSync(..., { withFileTypes: true })` gives the Dirent objects directly and eliminates the need to `statSync` everything, saving significant time. Remember to handle symlinks correctly though, as `dirent.isDirectory()` is false for symlinked directories.
**Action:** Default to `{ withFileTypes: true }` when scanning files in Node.js instead of calling `stat` for each file.
