const fs = require('fs');

function appendFileSyncNoFollow(filePath, content) {
  const fd = fs.openSync(
    filePath,
    fs.constants.O_CREAT | fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_NOFOLLOW,
    0o600
  );
  try {
    fs.writeFileSync(fd, content);
  } finally {
    fs.closeSync(fd);
  }
}

fs.writeFileSync('test.txt', 'hello\n');
appendFileSyncNoFollow('test.txt', 'world\n');
console.log(fs.readFileSync('test.txt', 'utf8'));
