const { vi } = require('vitest');

const mockApp = {
  isPackaged: false,
  whenReady: vi.fn().mockResolvedValue(),
  on: vi.fn(),
  quit: vi.fn(),
};

const mockBrowserWindow = vi.fn().mockImplementation(() => ({
  loadURL: vi.fn(),
  loadFile: vi.fn(),
  webContents: { openDevTools: vi.fn() },
}));
mockBrowserWindow.getAllWindows = vi.fn().mockReturnValue([]);

const mockIpcMain = {
  handle: vi.fn(),
};

module.exports = {
  app: mockApp,
  BrowserWindow: mockBrowserWindow,
  ipcMain: mockIpcMain,
};
