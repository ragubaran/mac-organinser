const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const WorkerPool = require('./worker-pool');

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
  return new Promise((resolve) => {
    try {
      const hashSum = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath);
      
      stream.on('data', (chunk) => {
        hashSum.update(chunk);
      });
      
      stream.on('end', () => {
        resolve(hashSum.digest('hex'));
      });
      
      stream.on('error', () => {
        resolve(null);
      });
    } catch (e) {
      resolve(null);
    }
  });
}

async function pMap(items, mapper, limit = 10) {
  const results = [];
  let i = 0;
  const workers = Array(Math.min(items.length, limit)).fill(null).map(async () => {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await mapper(items[idx]);
    }
  });
  await Promise.all(workers);
  return results;
}

async function findDuplicates(folderPathOrPaths, progressCallback) {
  const sizeMap = {};
  const duplicates = [];
  const visitedDirs = new Set();
  const visitedFiles = new Set();

  if (progressCallback) progressCallback('scanning_dirs', 0, 0);

  async function scanDir(dir) {
    try {
      let realDirPath = dir;
      try {
        if (typeof fs.promises.realpath === 'function') {
          realDirPath = await fs.promises.realpath(dir);
        } else if (typeof fs.realpathSync === 'function') {
          realDirPath = fs.realpathSync(dir);
        }
      } catch (e) {}

      if (visitedDirs.has(realDirPath)) return;
      visitedDirs.add(realDirPath);

      const files = await fs.promises.readdir(dir);
      
      await pMap(files, async (file) => {
        const fullPath = path.join(dir, file);
        try {
          const stats = await fs.promises.stat(fullPath);
          const isDirectory = typeof stats.isDirectory === 'function' ? stats.isDirectory() : false;
          if (isDirectory) {
            await scanDir(fullPath);
          } else {
            let realFilePath = fullPath;
            try {
              if (typeof fs.promises.realpath === 'function') {
                realFilePath = await fs.promises.realpath(fullPath);
              } else if (typeof fs.realpathSync === 'function') {
                realFilePath = fs.realpathSync(fullPath);
              }
            } catch (e) {}

            if (visitedFiles.has(realFilePath)) return;
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
      }, 20); // Concurrent limit for directory scan
    } catch (e) {
      // Ignore directory read error
    }
  }

  const folderPaths = Array.isArray(folderPathOrPaths)
    ? folderPathOrPaths.filter(Boolean)
    : (folderPathOrPaths ? [folderPathOrPaths] : []);

  const isTest = Boolean(process.env.VITEST || process.env.NODE_ENV === 'test');
  let scanPool = null;

  if (!isTest) {
    try {
      const scanWorkerScript = path.join(__dirname, 'scanner-worker.js');
      scanPool = new WorkerPool(scanWorkerScript);
    } catch (e) {}
  }

  if (scanPool && scanPool.workers.length > 0) {
    const queue = [...folderPaths];
    while (queue.length > 0) {
      const currentBatch = queue.splice(0, scanPool.workers.length * 2);
      const batchResults = await Promise.all(
        currentBatch.map(async (dir) => {
          if (!dir || typeof dir !== 'string') return null;
          const trimmed = dir.trim();
          if (!trimmed || visitedDirs.has(trimmed)) return null;
          visitedDirs.add(trimmed);
          try {
            return await scanPool.exec({ dirPath: trimmed });
          } catch (e) {
            return null;
          }
        })
      );

      for (const res of batchResults) {
        if (!res) continue;
        if (res.dirEntries) {
          for (const d of res.dirEntries) {
            if (!visitedDirs.has(d)) queue.push(d);
          }
        }
        if (res.fileEntries) {
          for (const f of res.fileEntries) {
            if (!visitedFiles.has(f.fullPath)) {
              visitedFiles.add(f.fullPath);
              if (!sizeMap[f.size]) {
                sizeMap[f.size] = [f.fullPath];
              } else {
                sizeMap[f.size].push(f.fullPath);
              }
            }
          }
        }
      }
    }
    try {
      scanPool.terminate();
    } catch (e) {}
  } else {
    await pMap(folderPaths, async (folder) => {
      if (typeof folder === 'string' && folder.trim()) {
        await scanDir(folder.trim());
      }
    }, 10);
  }

  // Count how many files need hashing
  let totalFilesToHash = 0;
  for (const [sizeStr, fileList] of Object.entries(sizeMap)) {
    if (fileList.length > 1) {
      totalFilesToHash += fileList.length;
    }
  }

  let hashedFiles = 0;
  if (progressCallback && totalFilesToHash > 0) {
    progressCallback('hashing', hashedFiles, totalFilesToHash);
  }

  let pool = null;
  if (!isTest) {
    try {
      const workerScript = path.join(__dirname, 'hash-worker.js');
      pool = new WorkerPool(workerScript);
    } catch (e) {}
  }

  async function computeHash(filePath) {
    if (pool && pool.workers.length > 0) {
      try {
        const res = await pool.exec({ filePath });
        if (res && res.checksum !== undefined) return res.checksum;
      } catch (e) {}
    }
    return await hashFile(filePath);
  }

  // Compare SHA-256 checksums for files that have identical sizes
  for (const [sizeStr, fileList] of Object.entries(sizeMap)) {
    if (fileList.length < 2) continue;

    const hashMap = {};
    await pMap(fileList, async (filePath) => {
      const checksum = await computeHash(filePath);
      hashedFiles++;
      
      if (progressCallback) {
        progressCallback('hashing', hashedFiles, totalFilesToHash);
      }

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
    }, 15); // Hash up to 15 files concurrently
  }

  if (pool) {
    try {
      pool.terminate();
    } catch (e) {}
  }

  return duplicates;
}

module.exports = {
  getFileSize,
  calculateFolderSize,
  hashFile,
  findDuplicates
};
