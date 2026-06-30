## 2023-10-27 - Node.js File System Traversal Optimization
**Learning:** In Node.js, recursive directory scanning using `fs.readdirSync()` combined with `fs.statSync()` in a loop is extremely slow because it makes two blocking system calls per file.
**Action:** Always use `fs.readdirSync(dir, { withFileTypes: true })` to get `fs.Dirent` objects which already contain the file type information, avoiding the need for `fs.statSync()` entirely, except for symbolic links where `fs.statSync` might be needed to follow the link to its destination.
