const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function getFileSize(filePath) {
  try {
    const stats = fs.statSync(filePath);
    return stats.size;
  } catch (e) {
    return 0;
  }
}

function calculateFolderSize(folderPath) {
  let totalSize = 0;
  try {
    const files = fs.readdirSync(folderPath);
    for (const file of files) {
      const fullPath = path.join(folderPath, file);
      const stats = fs.statSync(fullPath);
      const isDirectory = typeof stats.isDirectory === 'function' ? stats.isDirectory() : false;
      if (isDirectory) {
        totalSize += calculateFolderSize(fullPath);
      } else {
        totalSize += (stats.size || 0);
      }
    }
  } catch (e) {
    // Ignore errors for unreadable files/folders
  }
  return totalSize;
}

function hashFile(filePath) {
  try {
    const fileBuffer = fs.readFileSync(filePath);
    const hashSum = crypto.createHash('sha256');
    hashSum.update(fileBuffer);
    return hashSum.digest('hex');
  } catch (e) {
    return null;
  }
}

function findDuplicates(folderPathOrPaths) {
  const sizeMap = {};
  const duplicates = [];
  const visitedDirs = new Set();
  const visitedFiles = new Set();

  function scanDir(dir) {
    try {
      let realDirPath = dir;
      try {
        if (typeof fs.realpathSync === 'function') {
          realDirPath = fs.realpathSync(dir);
        }
      } catch (e) {}

      if (visitedDirs.has(realDirPath)) return;
      visitedDirs.add(realDirPath);

      const files = fs.readdirSync(dir);
      for (const file of files) {
        const fullPath = path.join(dir, file);
        try {
          const stats = fs.statSync(fullPath);
          const isDirectory = typeof stats.isDirectory === 'function' ? stats.isDirectory() : false;
          if (isDirectory) {
            scanDir(fullPath);
          } else {
            let realFilePath = fullPath;
            try {
              if (typeof fs.realpathSync === 'function') {
                realFilePath = fs.realpathSync(fullPath);
              }
            } catch (e) {}

            if (visitedFiles.has(realFilePath)) continue;
            visitedFiles.add(realFilePath);

            const size = (stats && stats.size !== undefined) ? stats.size : 0;
            if (!sizeMap[size]) {
              sizeMap[size] = [fullPath];
            } else {
              sizeMap[size].push(fullPath);
            }
          }
        } catch (e) {
          // Ignore individual file error
        }
      }
    } catch (e) {
      // Ignore directory read error
    }
  }

  const folderPaths = Array.isArray(folderPathOrPaths)
    ? folderPathOrPaths.filter(Boolean)
    : (folderPathOrPaths ? [folderPathOrPaths] : []);

  for (const folder of folderPaths) {
    if (typeof folder === 'string' && folder.trim()) {
      scanDir(folder.trim());
    }
  }

  // Compare SHA-256 checksums for files that have identical sizes
  for (const [sizeStr, fileList] of Object.entries(sizeMap)) {
    if (fileList.length < 2) continue;

    const hashMap = {};
    for (const filePath of fileList) {
      const checksum = hashFile(filePath);
      if (checksum) {
        if (hashMap[checksum]) {
          hashMap[checksum].push(filePath);
          duplicates.push({
            original: hashMap[checksum][0],
            duplicate: filePath,
            size: Number(sizeStr),
            checksum: checksum
          });
        } else {
          hashMap[checksum] = [filePath];
        }
      }
    }
  }

  return duplicates;
}

module.exports = {
  getFileSize,
  calculateFolderSize,
  hashFile,
  findDuplicates
};
