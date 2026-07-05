## ⚡ Bolt: Non-blocking file reads in `code_search`

* **What:** Replaced the synchronous file reading loop (`fs.readFileSync`) in the `code_search` tool implementation with an asynchronous, chunked approach using `fs.promises.readFile` and `Promise.allSettled`.
* **Why:** In Node.js, `fs.readFileSync` blocks the main event loop. If `code_search` is run on a large codebase, it would freeze the entire Node.js process, preventing any other concurrent MCP requests or events from being handled until the search completes.
* **Impact:** The tool is now non-blocking and processes files in manageable chunks (size 50). This allows the event loop to continue ticking and handling other tasks during the I/O waits, making the server significantly more robust under load without sacrificing search performance.
