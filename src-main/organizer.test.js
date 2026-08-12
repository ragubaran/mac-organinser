// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getCategoryForExtension, organizeFolder, defaultRules } from './organizer';
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

  describe('organizeFolder', () => {
    it('should organize files into category folders', () => {
      vi.spyOn(fs, 'readdirSync').mockImplementation((p) => {
        if (p === 'root') return ['image.jpg', 'doc.pdf', 'folder1'];
        return [];
      });
      
      vi.spyOn(fs, 'statSync').mockImplementation((p) => {
        if (p.endsWith('folder1')) return { isFile: () => false };
        return { isFile: () => true };
      });

      vi.spyOn(fs, 'existsSync').mockImplementation((p) => {
        return false; // Force mkdir
      });

      const mkdirSpy = vi.spyOn(fs, 'mkdirSync').mockImplementation(() => {});
      const renameSpy = vi.spyOn(fs, 'renameSync').mockImplementation(() => {});

      const result = organizeFolder('root');

      expect(result.moved).toBe(2);
      expect(result.errors).toBe(0);
      expect(mkdirSpy).toHaveBeenCalledTimes(2);
      expect(renameSpy).toHaveBeenCalledTimes(2);
      
      // Verify specific calls
      expect(renameSpy).toHaveBeenCalledWith(path.join('root', 'image.jpg'), path.join('root', 'Images', 'image.jpg'));
      expect(renameSpy).toHaveBeenCalledWith(path.join('root', 'doc.pdf'), path.join('root', 'Documents', 'doc.pdf'));
    });

    it('should handle errors when moving a file', () => {
      vi.spyOn(fs, 'readdirSync').mockImplementation((p) => {
        if (p === 'root') return ['image.jpg'];
        return [];
      });
      vi.spyOn(fs, 'statSync').mockReturnValue({ isFile: () => true });
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'renameSync').mockImplementation(() => { throw new Error('Permission denied'); });

      const result = organizeFolder('root');
      expect(result.moved).toBe(0);
      expect(result.errors).toBe(1);
    });

    it('should handle errors reading directory', () => {
      vi.spyOn(fs, 'readdirSync').mockImplementation(() => { throw new Error('Not found'); });
      
      const result = organizeFolder('root');
      expect(result.moved).toBe(0);
      expect(result.errors).toBe(1);
    });
  });
});
