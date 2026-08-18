const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const util = require('util');
const scanner = require('./src-main/scanner');
const organizer = require('./src-main/organizer');

const execPromise = util.promisify(exec);

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
    vibrancy: 'under-window',
    visualEffectState: 'active',
    titleBarStyle: 'hiddenInset'
  });

  const isDev = !app.isPackaged;

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, 'dist', 'index.html'));
  }
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

function getEnhancedEnv() {
  const env = { ...process.env };
  const home = env.HOME || '';
  const customPaths = [
    '/opt/homebrew/bin',
    '/opt/homebrew/sbin',
    '/usr/local/bin',
    '/usr/local/sbin',
    `${home}/.bun/bin`,
    `${home}/.pnpm`,
    `${home}/Library/pnpm`,
    `${home}/.local/share/pnpm`,
    `${home}/.local/bin`,
    `${home}/.yarn/bin`,
    `${home}/.config/yarn/global/node_modules/.bin`,
    `${home}/.fnm/current/bin`,
    `${home}/.asdf/shims`,
    `${home}/.volta/bin`,
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin'
  ];

  try {
    const nvmDir = path.join(home, '.nvm/versions/node');
    if (fs.existsSync(nvmDir)) {
      const versions = fs.readdirSync(nvmDir);
      for (const ver of versions) {
        customPaths.unshift(path.join(nvmDir, ver, 'bin'));
      }
    }
  } catch (e) {}

  env.PATH = Array.from(new Set(customPaths)).join(':') + (env.PATH ? `:${env.PATH}` : '');
  return env;
}

ipcMain.handle('clean-cache', async (event, commandName) => {
  try {
    let cmd = '';
    if (commandName === 'docker') cmd = 'docker system prune -a -f --volumes';
    if (commandName === 'npm') cmd = 'npm cache clean --force';
    if (commandName === 'pnpm') cmd = 'pnpm store prune';
    if (commandName === 'yarn') cmd = 'yarn cache clean';
    if (commandName === 'pip') cmd = 'python3 -m pip cache purge 2>/dev/null || pip cache purge';
    if (commandName === 'maven') cmd = 'rm -rf ~/.m2/repository';
    if (commandName === 'gradle') cmd = 'rm -rf ~/.gradle/caches';

    if (!cmd) return { success: false, error: 'Unknown command' };

    const env = getEnhancedEnv();
    const { stdout, stderr } = await execPromise(cmd, { env, shell: '/bin/zsh' });
    return { success: true, stdout: stdout || stderr || 'Cache cleaned successfully' };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('select-folder', async (event, options = {}) => {
  try {
    const properties = ['openDirectory'];
    if (options && options.allowMultiple) {
      properties.push('multiSelections');
    }
    const result = await dialog.showOpenDialog(mainWindow, {
      properties
    });
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    return (options && options.allowMultiple) ? result.filePaths : result.filePaths[0];
  } catch (error) {
    return null;
  }
});

ipcMain.handle('organize-folder', async (event, folderPath) => {
  try {
    const res = await organizer.organizeFolder(folderPath);
    return { success: true, ...res };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('find-duplicates', async (event, folderPathOrPaths) => {
  try {
    const progressCallback = (status, current, total) => {
      event.sender.send('duplicate-scan-progress', { status, current, total });
    };
    const duplicates = await scanner.findDuplicates(folderPathOrPaths, progressCallback);
    return { success: true, duplicates };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('delete-file', async (event, filePath) => {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return { success: true };
    }
    return { success: false, error: 'File does not exist' };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

