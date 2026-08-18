const fs = require('fs');
const path = require('path');

const defaultRules = {
  Images: ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'],
  Documents: ['.pdf', '.doc', '.docx', '.txt', '.md', '.csv', '.xlsx', '.xls', '.json', '.xml'],
  Archives: ['.zip', '.tar', '.gz', '.rar', '.7z', '.iso', '.dmg'],
  Audio: ['.mp3', '.wav', '.flac', '.m4a', '.aac', '.ogg'],
  Video: ['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv']
};

const categoryNames = Object.keys(defaultRules).concat(['Others']);

function getCategoryForExtension(ext, rules = defaultRules) {
  const lowerExt = ext.toLowerCase();
  for (const [category, extensions] of Object.entries(rules)) {
    if (extensions.includes(lowerExt)) {
      return category;
    }
  }
  return 'Others';
}

async function getUniqueFilePath(destFolder, fileName) {
  let targetPath = path.join(destFolder, fileName);
  
  const checkExists = async (p) => {
    try {
      await fs.promises.access(p);
      return true;
    } catch {
      return false;
    }
  };

  if (!(await checkExists(targetPath))) return targetPath;

  const ext = path.extname(fileName);
  const baseName = path.basename(fileName, ext);
  let counter = 1;

  while ((await checkExists(targetPath)) && counter < 1000) {
    targetPath = path.join(destFolder, `${baseName}_${counter}${ext}`);
    counter++;
  }
  return targetPath;
}

async function pMap(items, mapper, limit = 30) {
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

async function organizeFolder(folderPath, rules = defaultRules, recursive = true) {
  const results = {
    moved: 0,
    errors: 0
  };

  async function processDirectory(currentDir) {
    try {
      const items = await fs.promises.readdir(currentDir);

      await pMap(items, async (item) => {
        const fullPath = path.join(currentDir, item);
        try {
          const stats = await fs.promises.stat(fullPath);
          const isDirectory = typeof stats.isDirectory === 'function' ? stats.isDirectory() : (typeof stats.isFile === 'function' ? !stats.isFile() : false);
          const isFile = typeof stats.isFile === 'function' ? stats.isFile() : !isDirectory;

          if (isDirectory) {
            // Skip target category directories created at root level
            if (currentDir === folderPath && categoryNames.includes(item)) {
              return;
            }
            if (recursive) {
              await processDirectory(fullPath);
              try {
                await fs.promises.rm(fullPath, { recursive: true, force: true });
              } catch (e) {}
            }
          } else if (isFile) {
            const ext = path.extname(item);
            const category = getCategoryForExtension(ext, rules);
            const categoryFolder = path.join(folderPath, category);

            // Avoid moving if file is already in its destination category folder
            if (currentDir === categoryFolder) {
              return;
            }

            try {
              await fs.promises.access(categoryFolder);
            } catch (err) {
              await fs.promises.mkdir(categoryFolder, { recursive: true });
            }

            const newPath = await getUniqueFilePath(categoryFolder, item);
            await fs.promises.rename(fullPath, newPath);
            results.moved++;
          }
        } catch (e) {
          results.errors++;
        }
      }, 30); // 30 concurrent file operations per directory
    } catch (e) {
      results.errors++;
    }
  }

  await processDirectory(folderPath);
  return results;
}

module.exports = {
  defaultRules,
  getCategoryForExtension,
  organizeFolder
};
