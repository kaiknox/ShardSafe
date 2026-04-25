// components/HomeScreen.tsx
//
// Main file manager screen.
// Connects to the Node.js server via useP2P and renders the file list.
// File list updates in real time when peers add files (no refresh needed).

import { useRef } from 'react';
import { useP2P } from './useP2P';
import type { FileEntry } from './protocol';
import './App.css';

interface Props {
  mnemonic: string;
}

export default function HomeScreen({ mnemonic }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const {
    connected,
    p2pReady,
    files,
    loading,
    uploadFile,
    deleteFile,
    loadAll,
  } = useP2P(mnemonic);

  // ── Upload handler ─────────────────────────────────────────────────────────
  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = (reader.result as string).split(',')[1];
      try {
        await uploadFile(`/${file.name}`, base64);
        // No need to reload — server pushes file:added event automatically
      } catch (err) {
        console.error('Upload failed:', err);
        alert('Upload failed — is the P2P server running?');
      }
    };
    reader.readAsDataURL(file);

    // Reset input so same file can be re-selected
    e.target.value = '';
  };

  // ── Delete handler ─────────────────────────────────────────────────────────
  const handleDelete = async (path: string) => {
    if (!confirm(`Delete ${path}?`)) return;
    try {
      await deleteFile(path);
      // No need to reload — server pushes file:deleted event automatically
    } catch (err) {
      console.error('Delete failed:', err);
    }
  };

  return (
    <div className="hs-root">
      {/* ── Sidebar ── */}
      <aside className="hs-sidebar">
        <div className="hs-logo">⬡ ShardSafe</div>

        <div className="hs-status">
          <div className={`hs-dot ${connected ? 'hs-dot-on' : 'hs-dot-off'}`} />
          <span>{connected ? (p2pReady ? 'P2P active' : 'Connecting...') : 'Server offline'}</span>
        </div>

        <nav className="hs-nav">
          <button className="hs-nav-item hs-nav-active">All files</button>
          <button className="hs-nav-item">Shared with me</button>
          <button className="hs-nav-item">Devices</button>
        </nav>

        <div className="hs-sidebar-bottom">
          <button
            className="hs-upload-btn"
            onClick={() => fileInputRef.current?.click()}
          >
            + Upload file
          </button>
          <input
            ref={fileInputRef}
            type="file"
            style={{ display: 'none' }}
            onChange={handleUpload}
          />
        </div>
      </aside>

      {/* ── Main content ── */}
      <main className="hs-main">
        <div className="hs-header">
          <h1 className="hs-title">All files</h1>
          <button className="hs-refresh" onClick={loadAll} disabled={loading}>
            {loading ? '↻' : '↻ Refresh'}
          </button>
        </div>

        {/* File grid */}
        {files.length === 0 ? (
          <div className="hs-empty">
            <p>No files yet.</p>
            <p className="hs-empty-sub">Upload a file or wait for peers to sync.</p>
          </div>
        ) : (
          <div className="hs-grid">
            {files.map(file => (
              <FileCard
                key={file.path}
                file={file}
                onDelete={() => handleDelete(file.path)}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

// ─── File card ────────────────────────────────────────────────────────────────
function FileCard({ file, onDelete }: { file: FileEntry; onDelete: () => void }) {
  const ext  = file.path.split('.').pop()?.toUpperCase() ?? 'FILE';
  const name = file.path.split('/').pop() ?? file.path;
  const size = formatSize(file.size);
  const date = new Date(file.timestamp).toLocaleDateString();

  return (
    <div className="hs-card">
      <div className="hs-card-icon">{ext}</div>
      <div className="hs-card-info">
        <p className="hs-card-name">{name}</p>
        <p className="hs-card-meta">{size} · {date}</p>
      </div>
      <button className="hs-card-delete" onClick={onDelete} title="Delete">✕</button>
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024)        return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}