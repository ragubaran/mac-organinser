// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getFileSize, calculateFolderSize, hashFile, findDuplicates } from './scanner';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { EventEmitter } from 'events';

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
    it('should return hash of file', async () => {
      const mockUpdate = vi.fn();
      const mockDigest = vi.fn().mockReturnValue('mockhash');
      vi.spyOn(crypto, 'createHash').mockReturnValue({ update: mockUpdate, digest: mockDigest });
      
      const mockStream = new EventEmitter();
      vi.spyOn(fs, 'createReadStream').mockReturnValue(mockStream);

      const hashPromise = hashFile('test.txt');
      mockStream.emit('data', 'file content');
      mockStream.emit('end');
      
      const hash = await hashPromise;
      expect(hash).toBe('mockhash');
      expect(fs.createReadStream).toHaveBeenCalledWith('test.txt');
      expect(crypto.createHash).toHaveBeenCalledWith('sha256');
    });

    it('should return null if error occurs', async () => {
      const mockStream = new EventEmitter();
      vi.spyOn(fs, 'createReadStream').mockReturnValue(mockStream);
      
      const hashPromise = hashFile('missing.txt');
      mockStream.emit('error', new Error('Not found'));
      
      const hash = await hashPromise;
      expect(hash).toBeNull();
    });
  });

  describe('findDuplicates', () => {
    it('should find duplicates based on file hashes', async () => {
      vi.spyOn(fs.promises, 'readdir').mockImplementation(async (dir) => {
        if (dir === 'root') return ['file1.txt', 'subfolder'];
        if (dir === path.join('root', 'subfolder')) return ['file2.txt', 'file3.txt'];
        return [];
      });

      vi.spyOn(fs.promises, 'stat').mockImplementation(async (p) => {
        if (p === path.join('root', 'file1.txt')) return { size: 50, isDirectory: () => false };
        if (p === path.join('root', 'subfolder')) return { size: 0, isDirectory: () => true };
        if (p === path.join('root', 'subfolder', 'file2.txt')) return { size: 50, isDirectory: () => false };
        if (p === path.join('root', 'subfolder', 'file3.txt')) return { size: 60, isDirectory: () => false };
        return { size: 0, isDirectory: () => false };
      });

      vi.spyOn(crypto, 'createHash').mockImplementation(() => {
        let data = '';
        return {
          update: (d) => { data += d; },
          digest: () => data
        };
      });
      
      vi.spyOn(fs, 'createReadStream').mockImplementation((p) => {
        const stream = new EventEmitter();
        setTimeout(() => {
          if (p === path.join('root', 'file1.txt')) stream.emit('data', 'content A');
          if (p === path.join('root', 'subfolder', 'file2.txt')) stream.emit('data', 'content A'); // duplicate
          if (p === path.join('root', 'subfolder', 'file3.txt')) stream.emit('data', 'content B'); // unique
          stream.emit('end');
        }, 0);
        return stream;
      });

      const duplicates = await findDuplicates('root');
      expect(duplicates).toHaveLength(1);
      expect(duplicates[0]).toEqual(expect.objectContaining({
        original: path.join('root', 'file1.txt'),
        duplicate: path.join('root', 'subfolder', 'file2.txt')
      }));
    });

    it('should find duplicates across multiple directories', async () => {
      vi.spyOn(fs.promises, 'readdir').mockImplementation(async (dir) => {
        if (dir === 'dirA') return ['doc1.txt'];
        if (dir === 'dirB') return ['doc2.txt'];
        return [];
      });

      vi.spyOn(fs.promises, 'stat').mockImplementation(async (p) => {
        if (p === path.join('dirA', 'doc1.txt')) return { size: 50, isDirectory: () => false };
        if (p === path.join('dirB', 'doc2.txt')) return { size: 50, isDirectory: () => false };
        return { isDirectory: () => false };
      });

      vi.spyOn(crypto, 'createHash').mockImplementation(() => {
        let data = '';
        return {
          update: (d) => { data += d; },
          digest: () => 'identical-hash'
        };
      });

      vi.spyOn(fs, 'createReadStream').mockImplementation(() => {
        const stream = new EventEmitter();
        setTimeout(() => {
          stream.emit('data', 'same file content');
          stream.emit('end');
        }, 0);
        return stream;
      });

      const duplicates = await findDuplicates(['dirA', 'dirB']);
      expect(duplicates).toHaveLength(1);
      expect(duplicates[0]).toEqual(expect.objectContaining({
        original: path.join('dirA', 'doc1.txt'),
        duplicate: path.join('dirB', 'doc2.txt'),
        size: 50,
        checksum: 'identical-hash'
      }));
    });

    it('should handle duplicate folder arguments and empty/invalid input', async () => {
      vi.spyOn(fs.promises, 'readdir').mockImplementation(async (dir) => {
        if (dir === 'dirA') return ['doc1.txt'];
        return [];
      });
      vi.spyOn(fs.promises, 'stat').mockImplementation(async () => ({ size: 50, isDirectory: () => false }));
      vi.spyOn(crypto, 'createHash').mockImplementation(() => ({
        update: vi.fn(),
        digest: () => 'hash'
      }));
      vi.spyOn(fs, 'createReadStream').mockImplementation(() => {
        const stream = new EventEmitter();
        setTimeout(() => { stream.emit('end'); }, 0);
        return stream;
      });

      expect(await findDuplicates([])).toEqual([]);
      expect(await findDuplicates(null)).toEqual([]);
      expect(await findDuplicates(['dirA', 'dirA'])).toEqual([]);
    });

    it('should handle errors gracefully during scan', async () => {
      vi.spyOn(fs.promises, 'readdir').mockImplementation(async () => { throw new Error('Permission denied'); });
      const duplicates = await findDuplicates('root');
      expect(duplicates).toEqual([]);
    });
  });
});
