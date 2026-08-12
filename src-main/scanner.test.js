// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getFileSize, calculateFolderSize, hashFile, findDuplicates } from './scanner';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

describe('scanner', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('getFileSize', () => {
    it('should return file size if file exists', () => {
      vi.spyOn(fs, 'statSync').mockReturnValue({ size: 1024 });
      const size = getFileSize('test.txt');
      expect(size).toBe(1024);
      expect(fs.statSync).toHaveBeenCalledWith('test.txt');
    });

    it('should return 0 if file does not exist or error occurs', () => {
      vi.spyOn(fs, 'statSync').mockImplementation(() => { throw new Error('Not found'); });
      const size = getFileSize('missing.txt');
      expect(size).toBe(0);
    });
  });

  describe('calculateFolderSize', () => {
    it('should calculate total size of files and folders', () => {
      vi.spyOn(fs, 'readdirSync').mockImplementation((dir) => {
        if (dir === 'root') return ['file1.txt', 'subfolder'];
        if (dir === path.join('root', 'subfolder')) return ['file2.txt'];
        return [];
      });

      vi.spyOn(fs, 'statSync').mockImplementation((p) => {
        if (p === path.join('root', 'file1.txt')) return { size: 100, isDirectory: () => false };
        if (p === path.join('root', 'subfolder')) return { size: 0, isDirectory: () => true };
        if (p === path.join('root', 'subfolder', 'file2.txt')) return { size: 200, isDirectory: () => false };
        return { size: 0, isDirectory: () => false };
      });

      const total = calculateFolderSize('root');
      expect(total).toBe(300);
    });

    it('should return 0 if folder does not exist or error occurs', () => {
      vi.spyOn(fs, 'readdirSync').mockImplementation(() => { throw new Error('Not found'); });
      const total = calculateFolderSize('missing');
      expect(total).toBe(0);
    });
  });

  describe('hashFile', () => {
    it('should return hash of file', () => {
      const mockUpdate = vi.fn();
      const mockDigest = vi.fn().mockReturnValue('mockhash');
      vi.spyOn(crypto, 'createHash').mockReturnValue({ update: mockUpdate, digest: mockDigest });
      vi.spyOn(fs, 'readFileSync').mockReturnValue('file content');

      const hash = hashFile('test.txt');
      expect(hash).toBe('mockhash');
      expect(fs.readFileSync).toHaveBeenCalledWith('test.txt');
      expect(crypto.createHash).toHaveBeenCalledWith('sha256');
    });

    it('should return null if error occurs', () => {
      vi.spyOn(fs, 'readFileSync').mockImplementation(() => { throw new Error('Not found'); });
      const hash = hashFile('missing.txt');
      expect(hash).toBeNull();
    });
  });

  describe('findDuplicates', () => {
    it('should find duplicates based on file hashes', () => {
      vi.spyOn(fs, 'readdirSync').mockImplementation((dir) => {
        if (dir === 'root') return ['file1.txt', 'subfolder'];
        if (dir === path.join('root', 'subfolder')) return ['file2.txt', 'file3.txt'];
        return [];
      });

      vi.spyOn(fs, 'statSync').mockImplementation((p) => {
        if (p === path.join('root', 'file1.txt')) return { isDirectory: () => false };
        if (p === path.join('root', 'subfolder')) return { isDirectory: () => true };
        if (p === path.join('root', 'subfolder', 'file2.txt')) return { isDirectory: () => false };
        if (p === path.join('root', 'subfolder', 'file3.txt')) return { isDirectory: () => false };
        return { isDirectory: () => false };
      });

      vi.spyOn(crypto, 'createHash').mockImplementation(() => {
        let data = '';
        return {
          update: (d) => { data += d; },
          digest: () => data
        };
      });
      
      vi.spyOn(fs, 'readFileSync').mockImplementation((p) => {
        if (p === path.join('root', 'file1.txt')) return 'content A';
        if (p === path.join('root', 'subfolder', 'file2.txt')) return 'content A'; // duplicate
        if (p === path.join('root', 'subfolder', 'file3.txt')) return 'content B'; // unique
        return '';
      });

      const duplicates = findDuplicates('root');
      expect(duplicates).toHaveLength(1);
      expect(duplicates[0]).toEqual(expect.objectContaining({
        original: path.join('root', 'file1.txt'),
        duplicate: path.join('root', 'subfolder', 'file2.txt')
      }));
    });

    it('should handle errors gracefully during scan', () => {
      vi.spyOn(fs, 'readdirSync').mockImplementation(() => { throw new Error('Permission denied'); });
      const duplicates = findDuplicates('root');
      expect(duplicates).toEqual([]);
    });
  });
});
