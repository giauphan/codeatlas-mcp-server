const fs = require('fs');
async function test() {
  const flags = fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW;
  console.log("Flags:", flags);
}
test();
