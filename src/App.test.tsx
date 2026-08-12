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
    expect(screen.getByText('Duplicate Finder (Recursive)')).toBeInTheDocument();
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
});
