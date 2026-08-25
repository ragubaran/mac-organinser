const { parentPort } = require('worker_threads');
const fs = require('fs');
const path = require('path');

async function scanDirectoryTask(dirPath) {
  const fileEntries = [];
  const dirEntries = [];

  try {
    const items = await fs.promises.readdir(dirPath);
    for (const item of items) {
      if (item.startsWith('.')) continue; // Ignore hidden OS files
      const fullPath = path.join(dirPath, item);
      try {
        const stats = await fs.promises.stat(fullPath);
        if (stats.isDirectory()) {
          dirEntries.push(fullPath);
        } else if (stats.isFile()) {
          fileEntries.push({
            fullPath,
            size: (stats && stats.size !== undefined) ? stats.size : 0
          });
        }
      } catch (e) {}
    }
  } catch (e) {}

  return { fileEntries, dirEntries };
}

if (parentPort) {
  parentPort.on('message', async (data) => {
    const { id, dirPath } = data;
    const result = await scanDirectoryTask(dirPath);
    parentPort.postMessage({ id, dirPath, ...result });
  });
}
