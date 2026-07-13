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

        // Handle symlinks
        let isDir = entry.isDirectory();
        if (entry.isSymbolicLink()) {
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
console.time('statSync');
const res1 = getFilesSync(dir);
console.timeEnd('statSync');

console.time('withFileTypes');
const res2 = getFilesWithFileTypes(dir);
console.timeEnd('withFileTypes');

console.log('Results size:', res1.length, res2.length);
