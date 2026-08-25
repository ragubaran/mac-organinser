const { parentPort } = require('worker_threads');
const fs = require('fs');

if (parentPort) {
  parentPort.on('message', async (data) => {
    const { id, action, payload } = data;
    try {
      if (action === 'move_file') {
        const { source, dest } = payload;
        await fs.promises.rename(source, dest);
        parentPort.postMessage({ id, success: true, source, dest });
      } else if (action === 'stat_item') {
        const { filePath } = payload;
        const stats = await fs.promises.stat(filePath);
        parentPort.postMessage({
          id,
          success: true,
          filePath,
          isDirectory: stats.isDirectory(),
          isFile: stats.isFile(),
          size: stats.size
        });
      } else {
        parentPort.postMessage({ id, success: false, error: 'Unknown action' });
      }
    } catch (err) {
      parentPort.postMessage({ id, success: false, error: err.message });
    }
  });
}
