import { useState } from 'react';

interface LogEntry {
  id: string;
  timestamp: string;
  type: 'info' | 'error' | 'success';
  message: string;
  details?: string;
}

function formatBytes(bytes?: number) {
  if (bytes === undefined || bytes === null || isNaN(bytes)) return 'Unknown size';
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function App() {
  const [activeTab, setActiveTab] = useState<'cache' | 'organizer' | 'duplicate'>('cache');

  // Logs state
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isLogsOpen, setIsLogsOpen] = useState(false);
  const [logFilter, setLogFilter] = useState<'all' | 'error' | 'success'>('all');

  // Cache state
  const [isCleaning, setIsCleaning] = useState(false);
  const [activeCleanTool, setActiveCleanTool] = useState<string | null>(null);

  // Smart Organizer state
  const [organizerFolder, setOrganizerFolder] = useState('');
  const [organizerResult, setOrganizerResult] = useState<{ moved: number; errors: number } | null>(null);
  const [isOrganizing, setIsOrganizing] = useState(false);

  // Duplicate Finder state
  const [duplicateFolders, setDuplicateFolders] = useState<string[]>([]);
  const [duplicates, setDuplicates] = useState<Array<{ original: string; duplicate: string; size?: number; checksum?: string }>>([]);
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());
  const [isScanning, setIsScanning] = useState(false);
  const [hasScanned, setHasScanned] = useState(false);
  const [isDeletingBatch, setIsDeletingBatch] = useState(false);

  const addLog = (type: 'info' | 'error' | 'success', message: string, details?: string) => {
    const entry: LogEntry = {
      id: Math.random().toString(36).substring(2, 9),
      timestamp: new Date().toLocaleTimeString(),
      type,
      message,
      details
    };
    setLogs((prev) => [entry, ...prev]);
  };

  const getIpc = () => {
    if (typeof window !== 'undefined' && (window as any).require) {
      return (window as any).require('electron').ipcRenderer;
    }
    return null;
  };

  // Cache Cleaner handler
  const cleanCache = async (tool: string) => {
    const ipc = getIpc();
    if (!ipc) {
      alert('Electron IPC not available');
      addLog('error', 'Electron IPC not available');
      return;
    }
    setIsCleaning(true);
    setActiveCleanTool(tool);
    addLog('info', `Starting clean for ${tool}...`);
    try {
      const result = await ipc.invoke('clean-cache', tool);
      if (result.success) {
        addLog('success', `Successfully cleaned ${tool} cache!`, result.stdout || '');
        alert(`Successfully cleaned ${tool} cache!\n${result.stdout || ''}`);
      } else {
        addLog('error', `Failed to clean ${tool} cache: ${result.error || 'Unknown error'}`, result.error);
        alert(`Failed to clean ${tool} cache.\n${result.error || ''}`);
      }
    } catch (e: any) {
      addLog('error', `Exception cleaning ${tool}: ${e.message}`, e.stack);
      alert(`Error cleaning ${tool}: ${e.message}`);
    } finally {
      setIsCleaning(false);
      setActiveCleanTool(null);
    }
  };

  // Select folder dialog
  const handleSelectFolder = async (target: 'organizer' | 'duplicate') => {
    const ipc = getIpc();
    if (!ipc) {
      const pathInput = prompt(
        target === 'organizer'
          ? 'Enter folder path manually:'
          : 'Enter folder path(s) manually (comma-separated for multiple):'
      );
      if (pathInput) {
        if (target === 'organizer') {
          setOrganizerFolder(pathInput.trim());
          setOrganizerResult(null);
        } else {
          const entered = pathInput.split(',').map((p) => p.trim()).filter(Boolean);
          if (entered.length > 0) {
            setDuplicateFolders((prev) => Array.from(new Set([...prev, ...entered])));
            setDuplicates([]);
            setSelectedIndices(new Set());
            setHasScanned(false);
          }
        }
        addLog('info', `Manually entered folder(s) for ${target}: ${pathInput}`);
      }
      return;
    }
    try {
      const selected = await ipc.invoke('select-folder', { allowMultiple: target === 'duplicate' });
      if (selected) {
        if (target === 'organizer') {
          const singlePath = Array.isArray(selected) ? selected[0] : selected;
          setOrganizerFolder(singlePath);
          setOrganizerResult(null);
          addLog('info', `Selected folder for organizer: ${singlePath}`);
        } else {
          const newPaths: string[] = Array.isArray(selected) ? selected : [selected];
          setDuplicateFolders((prev) => Array.from(new Set([...prev, ...newPaths])));
          setDuplicates([]);
          setSelectedIndices(new Set());
          setHasScanned(false);
          addLog('info', `Added folder(s) for duplicate scan: ${newPaths.join(', ')}`);
        }
      }
    } catch (e: any) {
      addLog('error', `Failed to select folder for ${target}: ${e.message}`);
      alert(`Failed to select folder: ${e.message}`);
    }
  };

  const handleRemoveDuplicateFolder = (folderToRemove: string) => {
    setDuplicateFolders((prev) => prev.filter((f) => f !== folderToRemove));
    setDuplicates([]);
    setSelectedIndices(new Set());
    setHasScanned(false);
    addLog('info', `Removed folder from duplicate scan: ${folderToRemove}`);
  };

  const handleClearDuplicateFolders = () => {
    setDuplicateFolders([]);
    setDuplicates([]);
    setSelectedIndices(new Set());
    setHasScanned(false);
    addLog('info', 'Cleared all duplicate scan folders.');
  };

  // Smart Organizer action
  const handleOrganize = async () => {
    if (!organizerFolder) {
      alert('Please select a folder first.');
      return;
    }
    const ipc = getIpc();
    if (!ipc) return;
    setIsOrganizing(true);
    setOrganizerResult(null);
    addLog('info', `Starting recursive folder organization in: ${organizerFolder}`);
    try {
      const result = await ipc.invoke('organize-folder', organizerFolder);
      if (result.success) {
        setOrganizerResult({ moved: result.moved, errors: result.errors });
        addLog('success', `Organized folder recursively. Moved ${result.moved} file(s).`, `Errors encountered: ${result.errors}`);
      } else {
        addLog('error', `Failed to organize folder: ${result.error}`);
        alert(`Failed to organize folder: ${result.error}`);
      }
    } catch (e: any) {
      addLog('error', `Error organizing folder: ${e.message}`);
      alert(`Error: ${e.message}`);
    } finally {
      setIsOrganizing(false);
    }
  };

  // Duplicate Finder action
  const handleScanDuplicates = async () => {
    if (duplicateFolders.length === 0) {
      alert('Please select at least one folder first.');
      return;
    }
    const ipc = getIpc();
    if (!ipc) return;
    setIsScanning(true);
    setHasScanned(false);
    setSelectedIndices(new Set());
    addLog('info', `Scanning recursively for duplicates in ${duplicateFolders.length} directory/directories: ${duplicateFolders.join(', ')}`);
    try {
      const result = await ipc.invoke('find-duplicates', duplicateFolders);
      if (result.success) {
        const dups = result.duplicates || [];
        setDuplicates(dups);
        setHasScanned(true);
        addLog('success', `Recursive scan complete across ${duplicateFolders.length} directory/directories. Found ${dups.length} duplicate pair(s).`);
      } else {
        addLog('error', `Scan failed: ${result.error}`);
        alert(`Scan failed: ${result.error}`);
      }
    } catch (e: any) {
      addLog('error', `Error scanning duplicates: ${e.message}`);
      alert(`Error: ${e.message}`);
    } finally {
      setIsScanning(false);
    }
  };

  // Single delete duplicate file
  const handleDeleteDuplicate = async (duplicatePath: string, index: number) => {
    if (!confirm(`Are you sure you want to delete:\n${duplicatePath}?`)) return;
    const ipc = getIpc();
    if (!ipc) return;
    addLog('info', `Requesting delete for file: ${duplicatePath}`);
    try {
      const result = await ipc.invoke('delete-file', duplicatePath);
      if (result.success) {
        setDuplicates((prev) => prev.filter((_, i) => i !== index));
        setSelectedIndices((prev) => {
          const next = new Set<number>();
          prev.forEach((i) => {
            if (i < index) next.add(i);
            else if (i > index) next.add(i - 1);
          });
          return next;
        });
        addLog('success', `Successfully deleted duplicate file: ${duplicatePath}`);
        alert('File deleted successfully.');
      } else {
        addLog('error', `Failed to delete duplicate file: ${result.error}`);
        alert(`Failed to delete file: ${result.error}`);
      }
    } catch (e: any) {
      addLog('error', `Error deleting duplicate file: ${e.message}`);
      alert(`Error deleting file: ${e.message}`);
    }
  };

  // Toggle selection
  const toggleSelect = (index: number) => {
    setSelectedIndices((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  // Select all / deselect all
  const toggleSelectAll = () => {
    if (selectedIndices.size === duplicates.length) {
      setSelectedIndices(new Set());
    } else {
      setSelectedIndices(new Set(duplicates.map((_, i) => i)));
    }
  };

  // Delete selected duplicates
  const handleDeleteSelected = async () => {
    if (selectedIndices.size === 0) return;
    if (!confirm(`Are you sure you want to delete ${selectedIndices.size} selected duplicate file(s)?`)) return;

    const ipc = getIpc();
    if (!ipc) return;

    setIsDeletingBatch(true);
    const indicesToDelete = Array.from(selectedIndices).sort((a, b) => b - a);
    let deletedCount = 0;
    let failedCount = 0;

    for (const index of indicesToDelete) {
      const targetPath = duplicates[index].duplicate;
      try {
        const result = await ipc.invoke('delete-file', targetPath);
        if (result.success) {
          deletedCount++;
        } else {
          failedCount++;
          addLog('error', `Failed to delete: ${targetPath}`, result.error);
        }
      } catch (e: any) {
        failedCount++;
        addLog('error', `Error deleting: ${targetPath}`, e.message);
      }
    }

    setDuplicates((prev) => prev.filter((_, i) => !selectedIndices.has(i)));
    setSelectedIndices(new Set());
    setIsDeletingBatch(false);

    addLog('success', `Batch delete finished. Successfully deleted ${deletedCount} file(s). Failed: ${failedCount}`);
    alert(`Batch delete finished.\nDeleted: ${deletedCount}\nFailed: ${failedCount}`);
  };

  // Delete all duplicates
  const handleDeleteAll = async () => {
    if (duplicates.length === 0) return;
    if (!confirm(`⚠️ DANGER: Are you sure you want to delete ALL ${duplicates.length} duplicate file(s)?`)) return;

    const ipc = getIpc();
    if (!ipc) return;

    setIsDeletingBatch(true);
    let deletedCount = 0;
    let failedCount = 0;

    for (const pair of duplicates) {
      try {
        const result = await ipc.invoke('delete-file', pair.duplicate);
        if (result.success) {
          deletedCount++;
        } else {
          failedCount++;
          addLog('error', `Failed to delete: ${pair.duplicate}`, result.error);
        }
      } catch (e: any) {
        failedCount++;
        addLog('error', `Error deleting: ${pair.duplicate}`, e.message);
      }
    }

    setDuplicates([]);
    setSelectedIndices(new Set());
    setIsDeletingBatch(false);

    addLog('success', `Delete All finished. Deleted ${deletedCount} file(s). Failed: ${failedCount}`);
    alert(`Delete All finished.\nDeleted: ${deletedCount}\nFailed: ${failedCount}`);
  };

  const errorCount = logs.filter((l) => l.type === 'error').length;
  const filteredLogs = logs.filter((l) => {
    if (logFilter === 'error') return l.type === 'error';
    if (logFilter === 'success') return l.type === 'success';
    return true;
  });

  return (
    <div style={{ display: 'flex', height: '100vh', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Title bar area for macOS drag */}
      <div className="mac-title-bar">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div className="pulse-dot" />
          <span style={{ fontSize: '12px', fontWeight: 700, letterSpacing: '0.5px', color: '#94a3b8', textTransform: 'uppercase' }}>
            Mac Organizer & Cleaner
          </span>
        </div>

        {/* Small top log indicator button */}
        <button
          onClick={() => setIsLogsOpen(true)}
          className="btn no-drag"
          style={{
            padding: '4px 12px',
            fontSize: '11px',
            background: errorCount > 0 ? 'rgba(244, 63, 94, 0.15)' : 'rgba(30, 41, 59, 0.7)',
            color: errorCount > 0 ? '#f43f5e' : '#cbd5e1',
            border: errorCount > 0 ? '1px solid rgba(244, 63, 94, 0.4)' : '1px solid var(--border-glass)'
          }}
        >
          {errorCount > 0 ? `⚠️ ${errorCount} Failure(s)` : `📋 Logs (${logs.length})`}
        </button>
      </div>

      <div style={{ padding: '28px 32px', flex: 1, display: 'flex', flexDirection: 'column', gap: '28px', overflowY: 'auto' }}>
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: '32px', fontWeight: 800, letterSpacing: '-0.5px', background: 'var(--gradient-brand)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              Mac Organizer & Cleaner
            </h1>
            <p style={{ margin: '6px 0 0', color: '#94a3b8', fontSize: '14px', fontWeight: 500 }}>
              Automated workspace organizer, developer cache cleaner, and SHA-256 duplicate finder.
            </p>
          </div>
        </header>

        {/* Tab Navigation */}
        <div className="tab-nav">
          <button
            onClick={() => setActiveTab('cache')}
            className={`tab-btn ${activeTab === 'cache' ? 'active' : ''}`}
          >
            ⚡ Cache Cleaner
          </button>
          <button
            onClick={() => setActiveTab('organizer')}
            className={`tab-btn ${activeTab === 'organizer' ? 'active' : ''}`}
          >
            📁 Smart Organizer
          </button>
          <button
            onClick={() => setActiveTab('duplicate')}
            className={`tab-btn ${activeTab === 'duplicate' ? 'active' : ''}`}
          >
            🔍 Duplicate Finder
          </button>
        </div>

        {/* Tab 1: Cache Cleaner */}
        {activeTab === 'cache' && (
          <div className="glass-card animate-fade-in">
            <div style={{ marginBottom: '24px' }}>
              <h2 style={{ margin: 0, fontSize: '22px', fontWeight: 700, color: '#f8fafc' }}>Developer Cache Cleaner</h2>
              <p style={{ color: '#94a3b8', fontSize: '14px', marginTop: '4px' }}>
                Free up gigabytes of disk space by purging developer caches, build artifacts, and package stores.
              </p>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '18px' }}>
              {[
                { id: 'docker', name: 'Docker', desc: 'Prune unused containers, images & volumes', badge: 'Docker' },
                { id: 'npm', name: 'NPM', desc: 'Force clean global npm package cache', badge: 'Node.js' },
                { id: 'pnpm', name: 'PNPM', desc: 'Prune unreferenced pnpm global store', badge: 'Node.js' },
                { id: 'yarn', name: 'Yarn', desc: 'Clean global yarn cache directory', badge: 'Node.js' },
                { id: 'pip', name: 'Python (Pip)', desc: 'Purge global pip wheel package cache', badge: 'Python' },
                { id: 'maven', name: 'Java (Maven)', desc: 'Clean ~/.m2 local repository cache', badge: 'Java' },
                { id: 'gradle', name: 'Java (Gradle)', desc: 'Clean ~/.gradle build caches', badge: 'Java' },
              ].map((tool) => (
                <div
                  key={tool.id}
                  style={{
                    background: 'rgba(15, 23, 42, 0.6)',
                    padding: '20px',
                    borderRadius: '14px',
                    border: '1px solid var(--border-glass)',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    gap: '16px',
                    transition: 'all 0.2s ease'
                  }}
                >
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                      <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#38bdf8' }}>{tool.name}</h3>
                      <span className="badge badge-cyan">{tool.badge}</span>
                    </div>
                    <p style={{ margin: 0, fontSize: '12px', color: '#64748b', lineHeight: 1.4 }}>{tool.desc}</p>
                  </div>

                  <button
                    disabled={isCleaning}
                    onClick={() => cleanCache(tool.id)}
                    className="btn btn-danger"
                    style={{ width: '100%' }}
                  >
                    {isCleaning && activeCleanTool === tool.id ? 'Cleaning...' : `Clean ${tool.name}`}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tab 2: Smart Organizer */}
        {activeTab === 'organizer' && (
          <div className="glass-card animate-fade-in">
            <div style={{ marginBottom: '24px' }}>
              <h2 style={{ margin: 0, fontSize: '22px', fontWeight: 700, color: '#f8fafc' }}>Smart Organizer (Recursive)</h2>
              <p style={{ color: '#94a3b8', fontSize: '14px', marginTop: '4px' }}>
                Select a directory to organize top-level files and nested subfolder contents recursively into category folders.
              </p>
            </div>

            {/* Folder selection controls */}
            <div style={{ display: 'flex', gap: '14px', alignItems: 'center', marginBottom: '28px' }}>
              <button onClick={() => handleSelectFolder('organizer')} className="btn btn-secondary">
                📁 Choose Directory...
              </button>
              <input
                type="text"
                readOnly
                placeholder="No directory selected"
                value={organizerFolder}
                className="glass-input"
                style={{ flex: 1 }}
              />
              <button
                disabled={!organizerFolder || isOrganizing}
                onClick={handleOrganize}
                className="btn btn-primary"
              >
                {isOrganizing ? 'Organizing...' : '⚡ Organize Now'}
              </button>
            </div>

            {/* Rules preview */}
            <div style={{ background: 'rgba(15, 23, 42, 0.6)', padding: '20px', borderRadius: '14px', border: '1px solid var(--border-glass)' }}>
              <h4 style={{ margin: '0 0 14px', color: '#cbd5e1', fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Automatic Categories & Extensions:</h4>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
                {[
                  { name: 'Images', ext: '.jpg, .png, .gif, .webp, .svg' },
                  { name: 'Documents', ext: '.pdf, .docx, .txt, .md, .csv, .json' },
                  { name: 'Archives', ext: '.zip, .tar, .gz, .rar, .7z, .dmg' },
                  { name: 'Audio', ext: '.mp3, .wav, .flac, .m4a' },
                  { name: 'Video', ext: '.mp4, .mkv, .avi, .mov' },
                  { name: 'Others', ext: 'all uncategorized files' }
                ].map((cat) => (
                  <span key={cat.name} style={{ background: 'rgba(30, 41, 59, 0.7)', color: '#94a3b8', padding: '8px 14px', borderRadius: '8px', fontSize: '12px', border: '1px solid var(--border-glass)' }}>
                    <strong style={{ color: '#38bdf8' }}>{cat.name}:</strong> {cat.ext}
                  </span>
                ))}
              </div>
            </div>

            {/* Results output */}
            {organizerResult && (
              <div style={{ marginTop: '24px', padding: '18px 22px', borderRadius: '14px', background: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.3)', color: '#34d399', display: 'flex', alignItems: 'center', gap: '12px' }}>
                <span style={{ fontSize: '24px' }}>🎉</span>
                <div>
                  <strong style={{ fontSize: '15px' }}>Organization Complete!</strong>
                  <div style={{ fontSize: '13px', marginTop: '2px', opacity: 0.9 }}>
                    Moved <strong>{organizerResult.moved}</strong> file(s) into organized category folders. (Errors: {organizerResult.errors})
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Tab 3: Duplicate Finder */}
        {activeTab === 'duplicate' && (
          <div className="glass-card animate-fade-in">
            <div style={{ marginBottom: '24px' }}>
              <h2 style={{ margin: 0, fontSize: '22px', fontWeight: 700, color: '#f8fafc' }}>Duplicate Finder (Multi-Directory & Recursive)</h2>
              <p style={{ color: '#94a3b8', fontSize: '14px', marginTop: '4px' }}>
                Recursively scan across single or multiple directory trees for exact duplicate files using file size & SHA-256 checksum matching.
              </p>
            </div>

            {/* Folder selection controls */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginBottom: '28px' }}>
              <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
                <button onClick={() => handleSelectFolder('duplicate')} className="btn btn-secondary">
                  📁 Add Directory...
                </button>
                {duplicateFolders.length > 0 && (
                  <button onClick={handleClearDuplicateFolders} className="btn btn-secondary" style={{ color: '#f43f5e' }}>
                    ✕ Clear All ({duplicateFolders.length})
                  </button>
                )}
                <div style={{ flex: 1 }} />
                <button
                  disabled={duplicateFolders.length === 0 || isScanning}
                  onClick={handleScanDuplicates}
                  className="btn btn-primary"
                >
                  {isScanning
                    ? 'Scanning...'
                    : `🔍 Scan Duplicates ${duplicateFolders.length > 0 ? `(${duplicateFolders.length} Folders)` : ''}`}
                </button>
              </div>

              {/* List of selected folders */}
              {duplicateFolders.length === 0 ? (
                <div
                  style={{
                    padding: '24px',
                    textAlign: 'center',
                    background: 'rgba(15, 23, 42, 0.4)',
                    borderRadius: '12px',
                    border: '1px dashed var(--border-glass-bright)',
                    color: '#94a3b8',
                    fontSize: '13px'
                  }}
                >
                  📂 No directories added yet. Click <strong>"📁 Add Directory..."</strong> to select one or more directories to scan across.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '180px', overflowY: 'auto', paddingRight: '4px' }}>
                  {duplicateFolders.map((folder, idx) => (
                    <div
                      key={folder + idx}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '12px',
                        background: 'rgba(15, 23, 42, 0.6)',
                        padding: '10px 14px',
                        borderRadius: '10px',
                        border: '1px solid var(--border-glass)'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0, flex: 1 }}>
                        <span style={{ fontSize: '16px' }}>📁</span>
                        <span
                          title={folder}
                          style={{
                            color: '#f1f5f9',
                            fontSize: '13px',
                            fontFamily: 'monospace',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis'
                          }}
                        >
                          {folder}
                        </span>
                      </div>
                      <button
                        onClick={() => handleRemoveDuplicateFolder(folder)}
                        title="Remove directory"
                        style={{
                          background: 'rgba(244, 63, 94, 0.1)',
                          border: '1px solid rgba(244, 63, 94, 0.2)',
                          color: '#f43f5e',
                          borderRadius: '6px',
                          cursor: 'pointer',
                          padding: '4px 8px',
                          fontSize: '11px',
                          fontWeight: 'bold',
                          transition: 'all 0.15s ease'
                        }}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Duplicate Scan Results */}
            {hasScanned && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
                  <h3 style={{ fontSize: '16px', margin: 0, color: '#f1f5f9', fontWeight: 700 }}>
                    Scan Results ({duplicates.length} duplicate pair(s) found)
                  </h3>

                  {duplicates.length > 0 && (
                    <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                      <button
                        onClick={toggleSelectAll}
                        className="btn btn-secondary"
                        style={{ padding: '8px 14px', fontSize: '12px' }}
                      >
                        {selectedIndices.size === duplicates.length ? '☐ Deselect All' : '☑ Select All'}
                      </button>

                      <button
                        disabled={selectedIndices.size === 0 || isDeletingBatch}
                        onClick={handleDeleteSelected}
                        className="btn btn-danger"
                        style={{ padding: '8px 14px', fontSize: '12px' }}
                      >
                        🗑️ Delete Selected ({selectedIndices.size})
                      </button>

                      <button
                        disabled={isDeletingBatch}
                        onClick={handleDeleteAll}
                        className="btn btn-danger"
                        style={{ padding: '8px 14px', fontSize: '12px', background: 'linear-gradient(135deg, #b91c1c 0%, #991b1b 100%)' }}
                      >
                        🔥 Delete All ({duplicates.length})
                      </button>
                    </div>
                  )}
                </div>

                {duplicates.length === 0 ? (
                  <div style={{ padding: '32px', textAlign: 'center', background: 'rgba(16, 185, 129, 0.08)', borderRadius: '14px', border: '1px solid rgba(16, 185, 129, 0.2)', color: '#34d399' }}>
                    ✨ No duplicate files found across the {duplicateFolders.length} scanned directory/directories!
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {duplicates.map((pair, index) => {
                      const isSelected = selectedIndices.has(index);
                      return (
                        <div
                          key={index}
                          onClick={() => toggleSelect(index)}
                          style={{
                            background: isSelected ? 'rgba(99, 102, 241, 0.12)' : 'rgba(15, 23, 42, 0.6)',
                            padding: '18px',
                            borderRadius: '12px',
                            border: isSelected ? '1px solid var(--accent-indigo)' : '1px solid var(--border-glass)',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'flex-start',
                            gap: '16px',
                            cursor: 'pointer',
                            transition: 'all 0.15s ease'
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleSelect(index)}
                            onClick={(e) => e.stopPropagation()}
                            style={{ marginTop: '4px', cursor: 'pointer', width: '16px', height: '16px', accentColor: '#6366f1' }}
                          />

                          <div style={{ flex: 1, minWidth: 0, fontSize: '13px' }}>
                            <div style={{ display: 'flex', gap: '10px', marginBottom: '10px', flexWrap: 'wrap' }}>
                              <span className="badge badge-cyan">
                                Size: {formatBytes(pair.size)}
                              </span>
                              {pair.checksum && (
                                <span className="badge badge-purple" style={{ fontFamily: 'monospace' }}>
                                  SHA-256: {pair.checksum.slice(0, 16)}...
                                </span>
                              )}
                            </div>
                            <div style={{ color: '#94a3b8', marginBottom: '6px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              <strong style={{ color: '#38bdf8' }}>Original:</strong> {pair.original}
                            </div>
                            <div style={{ color: '#f43f5e', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              <strong>Duplicate:</strong> {pair.duplicate}
                            </div>
                          </div>

                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteDuplicate(pair.duplicate, index);
                            }}
                            className="btn btn-danger"
                            style={{ padding: '8px 14px', fontSize: '12px' }}
                          >
                            🗑️ Delete
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Logs Modal / Drawer */}
      {isLogsOpen && (
        <div className="modal-overlay">
          <div className="modal-content">
            {/* Modal Header */}
            <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--border-glass)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#f8fafc' }}>📋 App Logs & Failure Diagnostics</h3>
                {errorCount > 0 && (
                  <span className="badge badge-rose">
                    {errorCount} Error(s)
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                <button onClick={() => setLogs([])} className="btn btn-secondary" style={{ padding: '6px 12px', fontSize: '12px' }}>
                  Clear Logs
                </button>
                <button onClick={() => setIsLogsOpen(false)} style={{ background: 'transparent', color: '#94a3b8', border: 'none', fontSize: '20px', cursor: 'pointer', padding: '0 4px' }}>
                  ✕
                </button>
              </div>
            </div>

            {/* Filter controls */}
            <div style={{ padding: '12px 24px', background: '#0b101b', borderBottom: '1px solid var(--border-glass)', display: 'flex', gap: '8px' }}>
              <button
                onClick={() => setLogFilter('all')}
                className={`btn ${logFilter === 'all' ? 'btn-primary' : 'btn-secondary'}`}
                style={{ padding: '4px 12px', fontSize: '12px' }}
              >
                All ({logs.length})
              </button>
              <button
                onClick={() => setLogFilter('error')}
                className={`btn ${logFilter === 'error' ? 'btn-danger' : 'btn-secondary'}`}
                style={{ padding: '4px 12px', fontSize: '12px' }}
              >
                Failures / Errors ({errorCount})
              </button>
              <button
                onClick={() => setLogFilter('success')}
                className={`btn ${logFilter === 'success' ? 'btn-primary' : 'btn-secondary'}`}
                style={{ padding: '4px 12px', fontSize: '12px', background: logFilter === 'success' ? '#10b981' : undefined }}
              >
                Success ({logs.filter((l) => l.type === 'success').length})
              </button>
            </div>

            {/* Modal Body Log List */}
            <div style={{ padding: '20px 24px', flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {filteredLogs.length === 0 ? (
                <div style={{ textAlign: 'center', color: '#64748b', padding: '48px 0', fontSize: '14px' }}>
                  No logs recorded yet. Perform actions to view live execution events.
                </div>
              ) : (
                filteredLogs.map((log) => (
                  <div
                    key={log.id}
                    style={{
                      background: log.type === 'error' ? 'rgba(244, 63, 94, 0.08)' : log.type === 'success' ? 'rgba(16, 185, 129, 0.08)' : 'rgba(15, 23, 42, 0.8)',
                      borderLeft: `4px solid ${log.type === 'error' ? '#f43f5e' : log.type === 'success' ? '#10b981' : '#38bdf8'}`,
                      borderRadius: '8px',
                      padding: '14px',
                      fontSize: '13px'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                      <span
                        style={{
                          fontWeight: 800,
                          fontSize: '11px',
                          textTransform: 'uppercase',
                          letterSpacing: '0.5px',
                          color: log.type === 'error' ? '#f43f5e' : log.type === 'success' ? '#10b981' : '#38bdf8'
                        }}
                      >
                        {log.type}
                      </span>
                      <span style={{ fontSize: '11px', color: '#64748b', fontFamily: 'monospace' }}>{log.timestamp}</span>
                    </div>
                    <div style={{ color: log.type === 'error' ? '#fca5a5' : '#f8fafc', fontWeight: 500 }}>
                      {log.message}
                    </div>
                    {log.details && (
                      <pre style={{ margin: '10px 0 0', padding: '10px', background: '#030712', borderRadius: '6px', color: '#cbd5e1', fontSize: '11px', overflowX: 'auto', whiteSpace: 'pre-wrap', border: '1px solid var(--border-glass)' }}>
                        {log.details}
                      </pre>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
