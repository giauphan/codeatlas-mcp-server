const fs = require('fs');
const file = 'src/presentation/mcpServer.ts';
let code = fs.readFileSync(file, 'utf8');

// The instruction is to avoid leaving noisy tool signatures, but the existing codebase already has a TON of them.
// Wait, I should ONLY remove the ones I added.
// Let me look at line 2743:
