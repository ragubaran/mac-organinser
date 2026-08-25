// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getCategoryForExtension,
  organizeFolder,
  getFolderVideoStats,
  shouldMoveFolderAsVideoCategory,
  getFormattedDateDDMMYY,
  defaultRules
} from './organizer';
import fs from 'fs';
import path from 'path';

describe('organizer', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('getCategoryForExtension', () => {
    it('should return correct category for known extensions', () => {
      expect(getCategoryForExtension('.jpg')).toBe('Images');
      expect(getCategoryForExtension('.pdf')).toBe('Documents');
      expect(getCategoryForExtension('.zip')).toBe('Archives');
      expect(getCategoryForExtension('.mp4')).toBe('Video');
      expect(getCategoryForExtension('.mp3')).toBe('Audio');
    });

    it('should handle case insensitivity', () => {
      expect(getCategoryForExtension('.PNG')).toBe('Images');
    });

    it('should return Others for unknown extensions', () => {
      expect(getCategoryForExtension('.unknown')).toBe('Others');
      expect(getCategoryForExtension('')).toBe('Others');
    });
  });

  describe('video parent folder detection', () => {
    it('should detect multiple videos in a folder and recommend moving parent folder', async () => {
      vi.spyOn(fs.promises, 'readdir').mockImplementation(async (p) => {
        if (p === 'movieFolder') return ['vid1.mp4', 'vid2.mkv', 'info.txt'];
        return [];
      });
      vi.spyOn(fs.promises, 'stat').mockImplementation(async (p) => {
        return { isDirectory: () => false, isFile: () => true };
      });

      const stats = await getFolderVideoStats('movieFolder');
      expect(stats.directVideos).toBe(2);
      expect(stats.videoCount).toBe(2);
      expect(stats.nonVideoCount).toBe(1);

      const shouldMove = await shouldMoveFolderAsVideoCategory('movieFolder');
      expect(shouldMove).toBe(true);
    });

    it('should NOT recommend moving parent folder if only one video file exists', async () => {
      vi.spyOn(fs.promises, 'readdir').mockImplementation(async (p) => {
        if (p === 'singleVideoFolder') return ['vid1.mp4', 'doc1.pdf'];
        return [];
      });
      vi.spyOn(fs.promises, 'stat').mockImplementation(async (p) => {
        return { isDirectory: () => false, isFile: () => true };
      });

      const shouldMove = await shouldMoveFolderAsVideoCategory('singleVideoFolder');
      expect(shouldMove).toBe(false);
    });
  });

  describe('organizeFolder', () => {
    it('should organize individual files into category folders', async () => {
      vi.spyOn(fs.promises, 'readdir').mockImplementation(async (p) => {
        if (p === 'root') return ['image.jpg', 'doc.pdf'];
        return [];
      });
      
      vi.spyOn(fs.promises, 'stat').mockImplementation(async (p) => {
        return { isDirectory: () => false, isFile: () => true };
      });

      vi.spyOn(fs.promises, 'access').mockImplementation(async () => {
        throw new Error('Not found'); // Force mkdir & path check
      });

      const mkdirSpy = vi.spyOn(fs.promises, 'mkdir').mockImplementation(async () => {});
      const renameSpy = vi.spyOn(fs.promises, 'rename').mockImplementation(async () => {});

      const result = await organizeFolder('root');

      expect(result.moved).toBe(2);
      expect(result.errors).toBe(0);
      expect(mkdirSpy).toHaveBeenCalledTimes(2);
      expect(renameSpy).toHaveBeenCalledTimes(2);
      
      expect(renameSpy).toHaveBeenCalledWith(path.join('root', 'image.jpg'), path.join('root', 'Images', 'image.jpg'));
      expect(renameSpy).toHaveBeenCalledWith(path.join('root', 'doc.pdf'), path.join('root', 'Documents', 'doc.pdf'));
    });

    it('should move parent folder if subfolder contains multiple video files', async () => {
      vi.spyOn(fs.promises, 'readdir').mockImplementation(async (p) => {
        if (p === 'root') return ['MyVideos'];
        if (p === path.join('root', 'MyVideos')) return ['vid1.mp4', 'vid2.mp4'];
        return [];
      });

      vi.spyOn(fs.promises, 'stat').mockImplementation(async (p) => {
        if (p === path.join('root', 'MyVideos')) {
          return { isDirectory: () => true, isFile: () => false };
        }
        return { isDirectory: () => false, isFile: () => true };
      });

      vi.spyOn(fs.promises, 'access').mockImplementation(async () => {
        throw new Error('Not found');
      });

      const mkdirSpy = vi.spyOn(fs.promises, 'mkdir').mockImplementation(async () => {});
      const renameSpy = vi.spyOn(fs.promises, 'rename').mockImplementation(async () => {});

      const result = await organizeFolder('root');

      expect(result.moved).toBe(2);
      expect(result.errors).toBe(0);
      expect(mkdirSpy).toHaveBeenCalledWith(path.join('root', 'Video'), { recursive: true });
      expect(renameSpy).toHaveBeenCalledWith(
        path.join('root', 'MyVideos'),
        path.join('root', 'Video', 'MyVideos')
      );
    });

    it('should NOT move tutorial folders or tutorial video files', async () => {
      vi.spyOn(fs.promises, 'readdir').mockImplementation(async (p) => {
        if (p === 'root') return ['React_Course', 'Python_Tutorial.mp4', 'vacation.mp4'];
        if (p === path.join('root', 'React_Course')) return ['01_intro.mp4', 'App.jsx'];
        return [];
      });

      vi.spyOn(fs.promises, 'stat').mockImplementation(async (p) => {
        if (p === path.join('root', 'React_Course')) {
          return { isDirectory: () => true, isFile: () => false };
        }
        return { isDirectory: () => false, isFile: () => true };
      });

      vi.spyOn(fs.promises, 'access').mockImplementation(async () => {
        throw new Error('Not found');
      });

      const renameSpy = vi.spyOn(fs.promises, 'rename').mockImplementation(async () => {});

      const result = await organizeFolder('root');

      // Only vacation.mp4 should be moved. React_Course and Python_Tutorial.mp4 should be skipped.
      expect(result.moved).toBe(1);
      expect(renameSpy).toHaveBeenCalledTimes(1);
      expect(renameSpy).toHaveBeenCalledWith(path.join('root', 'vacation.mp4'), path.join('root', 'Video', 'vacation.mp4'));
    });

    it('should respect excludedCategories flags and skip moving excluded categories', async () => {
      vi.spyOn(fs.promises, 'readdir').mockImplementation(async (p) => {
        if (p === 'root') return ['clip.mp4', 'photo.jpg'];
        return [];
      });

      vi.spyOn(fs.promises, 'stat').mockImplementation(async () => {
        return { isDirectory: () => false, isFile: () => true };
      });

      vi.spyOn(fs.promises, 'access').mockImplementation(async () => {
        throw new Error('Not found');
      });

      const renameSpy = vi.spyOn(fs.promises, 'rename').mockImplementation(async () => {});

      // Exclude Video
      const result = await organizeFolder('root', defaultRules, true, undefined, { excludedCategories: ['Video'] });

      // Only photo.jpg should be moved to Images. clip.mp4 should be skipped.
      expect(result.moved).toBe(1);
      expect(renameSpy).toHaveBeenCalledTimes(1);
      expect(renameSpy).toHaveBeenCalledWith(path.join('root', 'photo.jpg'), path.join('root', 'Images', 'photo.jpg'));
    });

    it('should generate an audit log file with date dd-mm-yy in name', async () => {
      vi.spyOn(fs.promises, 'readdir').mockImplementation(async (p) => {
        if (p === 'root') return ['doc.pdf'];
        return [];
      });
      vi.spyOn(fs.promises, 'stat').mockImplementation(async () => ({ isDirectory: () => false, isFile: () => true }));
      vi.spyOn(fs.promises, 'access').mockImplementation(async () => { throw new Error('Not found'); });
      vi.spyOn(fs.promises, 'rename').mockImplementation(async () => {});
      const appendFileSpy = vi.spyOn(fs.promises, 'appendFile').mockImplementation(async () => {});

      const result = await organizeFolder('root');
      const expectedDateStr = getFormattedDateDDMMYY();
      const expectedFileName = `organizer-audit-${expectedDateStr}.log`;

      expect(result.auditLogPath).toBe(path.join('root', expectedFileName));
      expect(appendFileSpy).toHaveBeenCalledTimes(1);
      expect(appendFileSpy.mock.calls[0][0]).toBe(path.join('root', expectedFileName));
      const logContent = appendFileSpy.mock.calls[0][1];
      expect(logContent).toContain('ORGANIZATION AUDIT LOG');
      expect(logContent).toContain('[MOVED FILE]');
      expect(logContent).toContain(path.join('root', 'doc.pdf'));
    });

    it('should handle errors when moving a file', async () => {
      vi.spyOn(fs.promises, 'readdir').mockImplementation(async (p) => {
        if (p === 'root') return ['image.jpg'];
        return [];
      });
      vi.spyOn(fs.promises, 'stat').mockImplementation(async () => ({ isDirectory: () => false, isFile: () => true }));
      vi.spyOn(fs.promises, 'access').mockImplementation(async () => {});
      vi.spyOn(fs.promises, 'rename').mockImplementation(async () => { throw new Error('Permission denied'); });

      const result = await organizeFolder('root');
      expect(result.moved).toBe(0);
      expect(result.errors).toBe(1);
    });

    it('should handle errors reading directory', async () => {
      vi.spyOn(fs.promises, 'readdir').mockImplementation(async () => { throw new Error('Not found'); });
      
      const result = await organizeFolder('root');
      expect(result.moved).toBe(0);
      expect(result.errors).toBe(1);
    });
  });

  describe('WorkerPool', () => {
    it('should instantiate and terminate WorkerPool', () => {
      const WorkerPoolClass = require('./worker-pool');
      const pool = new WorkerPoolClass(path.join(__dirname, 'hash-worker.js'), 2);
      expect(pool.workers.length).toBe(2);
      pool.terminate();
      expect(pool.workers.length).toBe(0);
    });
  });
});
