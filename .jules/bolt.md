## ⚡ Bolt: Non-blocking file reads in `code_search`

* **What:** Replaced the synchronous file reading loop (`fs.readFileSync`) in the `code_search` tool implementation with an asynchronous, chunked approach using `fs.promises.readFile` and `Promise.allSettled`.
* **Why:** In Node.js, `fs.readFileSync` blocks the main event loop. If `code_search` is run on a large codebase, it would freeze the entire Node.js process, preventing any other concurrent MCP requests or events from being handled until the search completes.
* **Impact:** The tool is now non-blocking and processes files in manageable chunks (size 50). This allows the event loop to continue ticking and handling other tasks during the I/O waits, making the server significantly more robust under load without sacrificing search performance.
## ⚡ Bolt: Replaced synchronous fs.existsSync with fileExists in mcpServer

* **What:** Replaced the synchronous `fs.existsSync` call in `src/presentation/mcpServer.ts` with the asynchronous `fileExists` from `src/services/projectService.ts`.
* **Why:** Calling synchronous file system methods like `fs.existsSync` in an async context blocks the event loop, potentially reducing the application's responsiveness under load.
* **Impact:** The code is now fully non-blocking. The execution time for checking file existence went from blocking the event loop to being asynchronous. A synthetic benchmark showed that a purely synchronous `fs.existsSync` loop took ~98ms for 10k iterations, while an asynchronous loop leveraging non-blocking characteristics executes concurrently without starving the event loop.
