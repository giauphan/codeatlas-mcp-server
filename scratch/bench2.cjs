const fs = require('fs');
const path = require('path');

function getFilesSync(dir, fileList = [], depth = 0) {
    if (depth > 10) return fileList;
    let files;
    try {
        files = fs.readdirSync(dir);
    } catch {
        return fileList;
    }
    for (const file of files) {
        if (file.startsWith('.')) continue;
        const filePath = path.join(dir, file);
        let stat;
        try {
            stat = fs.statSync(filePath);
        } catch {
            continue;
        }
        if (stat.isDirectory()) {
            getFilesSync(filePath, fileList, depth + 1);
        } else if (file.endsWith('.js') || file.endsWith('.ts')) {
            fileList.push(filePath);
        }
    }
    return fileList;
}

function getFilesWithFileTypes(dir, fileList = [], depth = 0) {
    if (depth > 10) return fileList;
    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return fileList;
    }
    for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        const filePath = path.join(dir, entry.name);

        let isDir = entry.isDirectory();
        if (!isDir && entry.isSymbolicLink()) {
            try {
                isDir = fs.statSync(filePath).isDirectory();
            } catch {
                continue;
            }
        }

        if (isDir) {
            getFilesWithFileTypes(filePath, fileList, depth + 1);
        } else if (entry.name.endsWith('.js') || entry.name.endsWith('.ts')) {
            fileList.push(filePath);
        }
    }
    return fileList;
}

const dir = './node_modules';

// Warm up
getFilesSync(dir);
getFilesWithFileTypes(dir);

let t1 = 0, t2 = 0;
for (let i=0; i<10; i++) {
  const start1 = performance.now();
  getFilesSync(dir);
  t1 += performance.now() - start1;

  const start2 = performance.now();
  getFilesWithFileTypes(dir);
  t2 += performance.now() - start2;
}

console.log('statSync avg:', t1/10, 'ms');
console.log('withFileTypes avg:', t2/10, 'ms');
