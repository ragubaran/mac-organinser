// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import App from './App';
import { vi, describe, it, expect, beforeEach } from 'vitest';

describe('App', () => {
  beforeEach(() => {
    (window as any).require = vi.fn().mockReturnValue({
      ipcRenderer: {
        invoke: vi.fn().mockResolvedValue({ success: true, stdout: 'cleaned' })
      }
    });
    window.alert = vi.fn();
  });

  it('renders the title', () => {
    render(<App />);
    expect(screen.getAllByText('Mac Organizer & Cleaner')[0]).toBeInTheDocument();
  });

  it('renders the tabs and can switch to them', () => {
    render(<App />);
    
    // Default is cache tab
    expect(screen.getByText('Developer Cache Cleaner')).toBeInTheDocument();
    
    // Switch to Organizer
    fireEvent.click(screen.getByText('📁 Smart Organizer'));
    expect(screen.getByText('Smart Organizer (Recursive)')).toBeInTheDocument();

    // Switch to Duplicate Finder
    fireEvent.click(screen.getByText('🔍 Duplicate Finder'));
    expect(screen.getByText('Duplicate Finder (Multi-Directory & Recursive)')).toBeInTheDocument();
  });

  it('can trigger clean cache actions', async () => {
    render(<App />);
    const dockerBtn = screen.getByText('Clean Docker');
    fireEvent.click(dockerBtn);

    await waitFor(() => {
      expect((window as any).require).toHaveBeenCalledWith('electron');
      expect(window.alert).toHaveBeenCalledWith('Successfully cleaned docker cache!\ncleaned');
    });
  });

  it('handles clean cache failure', async () => {
    (window as any).require = vi.fn().mockReturnValue({
      ipcRenderer: {
        invoke: vi.fn().mockResolvedValue({ success: false, error: 'failed to clean' })
      }
    });

    render(<App />);
    const npmBtn = screen.getByText('Clean NPM');
    fireEvent.click(npmBtn);

    await waitFor(() => {
      expect(window.alert).toHaveBeenCalledWith('Failed to clean npm cache.\nfailed to clean');
    });
  });

  it('supports adding multiple directories and scanning duplicates', async () => {
    const invokeMock = vi.fn().mockImplementation((channel, _args) => {
      if (channel === 'select-folder') {
        return ['/path/folderA', '/path/folderB'];
      }
      if (channel === 'find-duplicates') {
        return {
          success: true,
          duplicates: [
            {
              original: '/path/folderA/photo1.jpg',
              duplicate: '/path/folderB/photo1_copy.jpg',
              size: 2048,
              checksum: 'abcd1234efgh5678'
            }
          ]
        };
      }
      return { success: true };
    });

    (window as any).require = vi.fn().mockReturnValue({
      ipcRenderer: { invoke: invokeMock }
    });

    render(<App />);

    // Switch to Duplicate Finder
    fireEvent.click(screen.getByText('🔍 Duplicate Finder'));

    // Click Add Directory
    const addDirBtn = screen.getByText('📁 Add Directory...');
    fireEvent.click(addDirBtn);

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('select-folder', { allowMultiple: true });
      expect(screen.getByText('/path/folderA')).toBeInTheDocument();
      expect(screen.getByText('/path/folderB')).toBeInTheDocument();
    });

    // Scan duplicates
    const scanBtn = screen.getByText('🔍 Scan Duplicates (2 Folders)');
    fireEvent.click(scanBtn);

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('find-duplicates', ['/path/folderA', '/path/folderB']);
      expect(screen.getByText('Scan Results (1 duplicate pair(s) found)')).toBeInTheDocument();
      expect(screen.getByText('/path/folderA/photo1.jpg')).toBeInTheDocument();
      expect(screen.getByText('/path/folderB/photo1_copy.jpg')).toBeInTheDocument();
    });
  });
});
