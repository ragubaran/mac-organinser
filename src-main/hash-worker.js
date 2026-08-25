const { parentPort } = require('worker_threads');
const fs = require('fs');
const crypto = require('crypto');

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

if (parentPort) {
  parentPort.on('message', async (data) => {
    const { id, filePath } = data;
    const checksum = await hashFile(filePath);
    parentPort.postMessage({ id, filePath, checksum });
  });
}

module.exports = { hashFile };
