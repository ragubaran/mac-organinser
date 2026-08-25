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

const TUTORIAL_KEYWORDS = /(?:^|[^a-zA-Z0-9])(tutorial|tutorials|course|courses|lesson|lessons|lecture|lectures|workshop|workshops|bootcamp|masterclass|training|udemy|coursera|pluralsight|skillshare|frontendmasters|scrimba|linkedin\s*learning|class|classes)(?:$|[^a-zA-Z0-9])/i;

const TUTORIAL_NUMBERING = /(?:^|[^a-zA-Z0-9])(lesson|lecture|chapter|module|section|part)\s*[-_.]?\s*\d+/i;

const NUMBERED_LESSON_PREFIX = /^(\d{1,3})\s*[-._\s]+\s*(intro|introduction|getting[_\s]started|basic|advanced|setup|installation|overview|chapter|lesson|lecture|module|section|part)/i;

const CODE_EXTENSIONS = ['.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.cpp', '.c', '.h', '.cs', '.go', '.rs', '.php', '.html', '.css', '.scss', '.ipynb', '.sql', '.sh', '.bash', '.swift', '.kt'];

function isTutorialName(name) {
  if (!name) return false;
  return (
    TUTORIAL_KEYWORDS.test(name) ||
    TUTORIAL_NUMBERING.test(name) ||
    NUMBERED_LESSON_PREFIX.test(name)
  );
}

function isTutorialPath(filePath, rootFolder) {
  if (!filePath) return false;
  const relPath = rootFolder ? path.relative(rootFolder, filePath) : filePath;
  const segments = relPath.split(path.sep);
  for (const seg of segments) {
    if (isTutorialName(seg)) return true;
  }
  return false;
}

async function isTutorialDirectory(dirPath, rules = defaultRules) {
  if (isTutorialName(path.basename(dirPath))) return true;

  try {
    const items = await fs.promises.readdir(dirPath);
    let hasCode = false;
    let hasVideos = false;
    let hasLessonNames = false;

    for (const item of items) {
      if (item.startsWith('.')) continue;
      const ext = path.extname(item).toLowerCase();
      if (CODE_EXTENSIONS.includes(ext)) {
        hasCode = true;
      }
      if (getCategoryForExtension(ext, rules) === 'Video') {
        hasVideos = true;
      }
      if (isTutorialName(item)) {
        hasLessonNames = true;
      }
    }

    if (hasVideos && (hasCode || hasLessonNames)) {
      return true;
    }
  } catch (e) {}

  return false;
}

async function getFolderVideoStats(dirPath, rules = defaultRules) {
  let directVideos = 0;
  let videoCount = 0;
  let nonVideoCount = 0;

  async function scan(currentDir, isRoot) {
    try {
      const items = await fs.promises.readdir(currentDir);
      for (const item of items) {
        if (item.startsWith('.')) continue;
        const fullPath = path.join(currentDir, item);
        try {
          const stats = await fs.promises.stat(fullPath);
          const isDirectory = typeof stats.isDirectory === 'function' ? stats.isDirectory() : false;
          if (isDirectory) {
            await scan(fullPath, false);
          } else {
            const ext = path.extname(item);
            const category = getCategoryForExtension(ext, rules);
            if (category === 'Video') {
              videoCount++;
              if (isRoot) directVideos++;
            } else {
              nonVideoCount++;
            }
          }
        } catch (e) {}
      }
    } catch (e) {}
  }

  await scan(dirPath, true);
  return { directVideos, videoCount, nonVideoCount };
}

async function shouldMoveFolderAsVideoCategory(dirPath, rules = defaultRules) {
  if (isTutorialName(path.basename(dirPath))) return false;
  const stats = await getFolderVideoStats(dirPath, rules);
  return stats.directVideos >= 2 || (stats.videoCount >= 2 && stats.videoCount >= stats.nonVideoCount);
}

function getFormattedDateDDMMYY(d = new Date()) {
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = String(d.getFullYear()).slice(-2);
  return `${day}-${month}-${year}`;
}

function isAuditLogFile(fileName) {
  if (!fileName) return false;
  const lower = fileName.toLowerCase();
  return lower.startsWith('organizer-audit') || lower === 'log-file.log';
}

const WorkerPool = require('./worker-pool');

async function organizeFolder(folderPath, rules = defaultRules, recursive = true, progressCallback, options = {}) {
  const { excludedCategories = [], excludedExtensions = [] } = options || {};
  const lowerExcludedCats = (excludedCategories || []).map((c) => String(c).toLowerCase());
  const lowerExcludedExts = (excludedExtensions || []).map((e) => String(e).toLowerCase());

  function isExcluded(ext, category) {
    if (lowerExcludedExts.includes(ext.toLowerCase())) return true;
    if (lowerExcludedCats.includes(category.toLowerCase())) return true;
    return false;
  }

  let pool = null;
  const isTest = Boolean(process.env.VITEST || process.env.NODE_ENV === 'test');
  if (!isTest) {
    try {
      const workerScript = path.join(__dirname, 'organizer-worker.js');
      pool = new WorkerPool(workerScript);
    } catch (e) {}
  }

  async function performMove(source, dest) {
    if (pool && pool.workers.length > 0) {
      try {
        const res = await pool.exec({ action: 'move_file', payload: { source, dest } });
        if (res && res.success) return;
      } catch (e) {}
    }
    await fs.promises.rename(source, dest);
  }

  const dateStr = getFormattedDateDDMMYY();
  const auditLogFileName = `organizer-audit-${dateStr}.log`;
  const auditLogFile = path.join(folderPath, auditLogFileName);

  const results = {
    moved: 0,
    errors: 0,
    auditLogPath: auditLogFile
  };

  const auditEntries = [];
  const nowStr = new Date().toISOString().replace('T', ' ').substring(0, 19);

  auditEntries.push('=' .repeat(80));
  auditEntries.push(`ORGANIZATION AUDIT LOG | Date: ${nowStr}`);
  auditEntries.push(`Target Directory: ${folderPath}`);
  auditEntries.push(`Options: Recursive = ${recursive}, Excluded Categories = [${excludedCategories.join(', ')}]`);
  auditEntries.push('=' .repeat(80));

  function logAudit(action, details) {
    const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
    auditEntries.push(`[${timestamp}] [${action}] ${details}`);
  }

  let totalFiles = 0;
  let processedFiles = 0;

  async function countFiles(currentDir) {
    try {
      if (currentDir !== folderPath) {
        if (isTutorialPath(currentDir, folderPath) || (await isTutorialDirectory(currentDir, rules))) {
          return;
        }
      }

      const items = await fs.promises.readdir(currentDir);
      for (const item of items) {
        if (isAuditLogFile(item)) continue;
        const fullPath = path.join(currentDir, item);
        try {
          const stats = await fs.promises.stat(fullPath);
          const isDirectory = typeof stats.isDirectory === 'function' ? stats.isDirectory() : false;
          
          if (isDirectory) {
            if (currentDir === folderPath && categoryNames.includes(item)) {
              continue;
            }
            if (recursive) {
              await countFiles(fullPath);
            }
          } else {
            const ext = path.extname(item);
            const category = getCategoryForExtension(ext, rules);
            if (!isTutorialName(item) && !isTutorialPath(fullPath, folderPath) && !isExcluded(ext, category)) {
              totalFiles++;
            }
          }
        } catch (e) {}
      }
    } catch (e) {}
  }

  if (progressCallback) progressCallback('counting', 0, 0);
  await countFiles(folderPath);

  async function processDirectory(currentDir) {
    try {
      const items = await fs.promises.readdir(currentDir);

      await pMap(items, async (item) => {
        if (isAuditLogFile(item)) return;
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

            // Skip tutorial directories
            if (isTutorialPath(fullPath, folderPath) || (await isTutorialDirectory(fullPath, rules))) {
              logAudit('SKIPPED TUTORIAL FOLDER', fullPath);
              return;
            }

            if (recursive) {
              const isVideoParent = !lowerExcludedCats.includes('video') && (await shouldMoveFolderAsVideoCategory(fullPath, rules));
              if (isVideoParent) {
                const categoryFolder = path.join(folderPath, 'Video');
                try {
                  await fs.promises.access(categoryFolder);
                } catch (err) {
                  await fs.promises.mkdir(categoryFolder, { recursive: true });
                }

                const statsInfo = await getFolderVideoStats(fullPath, rules);
                const subFilesCount = statsInfo.videoCount + statsInfo.nonVideoCount;

                const newPath = await getUniqueFilePath(categoryFolder, item);
                await performMove(fullPath, newPath);

                logAudit('MOVED PARENT FOLDER', `${fullPath} -> ${newPath}`);
                results.moved += (subFilesCount || 1);
                processedFiles += subFilesCount;
                if (progressCallback) progressCallback('organizing', processedFiles, totalFiles);
                return;
              }

              await processDirectory(fullPath);
              try {
                await fs.promises.rm(fullPath, { recursive: true, force: true });
              } catch (e) {}
            }
          } else if (isFile) {
            // Skip tutorial files
            if (isTutorialName(item) || isTutorialPath(fullPath, folderPath)) {
              logAudit('SKIPPED TUTORIAL FILE', fullPath);
              return;
            }

            const ext = path.extname(item);
            const category = getCategoryForExtension(ext, rules);

            // Skip excluded category or extension
            if (isExcluded(ext, category)) {
              logAudit('SKIPPED EXCLUDED FILE', `${fullPath} (Category: ${category})`);
              return;
            }

            const categoryFolder = path.join(folderPath, category);

            // Avoid moving if file is already in its destination category folder
            if (currentDir === categoryFolder) {
              processedFiles++;
              if (progressCallback) progressCallback('organizing', processedFiles, totalFiles);
              return;
            }

            try {
              await fs.promises.access(categoryFolder);
            } catch (err) {
              await fs.promises.mkdir(categoryFolder, { recursive: true });
            }

            const newPath = await getUniqueFilePath(categoryFolder, item);
            await performMove(fullPath, newPath);
            logAudit('MOVED FILE', `${fullPath} -> ${newPath}`);
            results.moved++;
            processedFiles++;
            if (progressCallback) progressCallback('organizing', processedFiles, totalFiles);
          }
        } catch (e) {
          logAudit('ERROR', `Failed processing ${fullPath}: ${e.message}`);
          results.errors++;
          processedFiles++; // Even if error, it's processed
          if (progressCallback) progressCallback('organizing', processedFiles, totalFiles);
        }
      }, 30); // 30 concurrent file operations per directory
    } catch (e) {
      logAudit('ERROR', `Failed reading directory ${currentDir}: ${e.message}`);
      results.errors++;
    }
  }

  await processDirectory(folderPath);

  if (pool) {
    try {
      pool.terminate();
    } catch (e) {}
  }

  auditEntries.push('-'.repeat(80));
  auditEntries.push(`Summary: Moved = ${results.moved}, Errors = ${results.errors}`);
  auditEntries.push('=' .repeat(80) + '\n\n');

  try {
    await fs.promises.appendFile(auditLogFile, auditEntries.join('\n'), 'utf8');
    results.auditLogPath = auditLogFile;
  } catch (e) {}

  return results;
}

module.exports = {
  defaultRules,
  getCategoryForExtension,
  getFolderVideoStats,
  shouldMoveFolderAsVideoCategory,
  isTutorialName,
  isTutorialPath,
  isTutorialDirectory,
  getFormattedDateDDMMYY,
  isAuditLogFile,
  organizeFolder
};
