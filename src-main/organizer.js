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

function getUniqueFilePath(destFolder, fileName) {
  let targetPath = path.join(destFolder, fileName);
  if (!fs.existsSync(targetPath)) return targetPath;

  const ext = path.extname(fileName);
  const baseName = path.basename(fileName, ext);
  let counter = 1;

  while (fs.existsSync(targetPath) && counter < 1000) {
    targetPath = path.join(destFolder, `${baseName}_${counter}${ext}`);
    counter++;
  }
  return targetPath;
}

function organizeFolder(folderPath, rules = defaultRules, recursive = true) {
  const results = {
    moved: 0,
    errors: 0
  };

  function processDirectory(currentDir) {
    try {
      const items = fs.readdirSync(currentDir);

      for (const item of items) {
        const fullPath = path.join(currentDir, item);
        try {
          const stats = fs.statSync(fullPath);
          const isDirectory = typeof stats.isDirectory === 'function' ? stats.isDirectory() : (typeof stats.isFile === 'function' ? !stats.isFile() : false);
          const isFile = typeof stats.isFile === 'function' ? stats.isFile() : !isDirectory;

          if (isDirectory) {
            // Skip target category directories created at root level
            if (currentDir === folderPath && categoryNames.includes(item)) {
              continue;
            }
            if (recursive) {
              processDirectory(fullPath);
              // Clean up empty subdirectories after moving files out
              try {
                const remaining = fs.readdirSync(fullPath);
                if (remaining.length === 0) {
                  fs.rmdirSync(fullPath);
                }
              } catch (e) {}
            }
          } else if (isFile) {
            const ext = path.extname(item);
            const category = getCategoryForExtension(ext, rules);
            const categoryFolder = path.join(folderPath, category);

            // Avoid moving if file is already in its destination category folder
            if (currentDir === categoryFolder) {
              continue;
            }

            if (!fs.existsSync(categoryFolder)) {
              fs.mkdirSync(categoryFolder, { recursive: true });
            }

            const newPath = getUniqueFilePath(categoryFolder, item);
            fs.renameSync(fullPath, newPath);
            results.moved++;
          }
        } catch (e) {
          results.errors++;
        }
      }
    } catch (e) {
      results.errors++;
    }
  }

  processDirectory(folderPath);
  return results;
}

module.exports = {
  defaultRules,
  getCategoryForExtension,
  organizeFolder
};
