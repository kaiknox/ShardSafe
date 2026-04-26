// HomeScreen.tsx

import { useEffect, useRef, useState } from 'react';
import { useP2P } from './useP2P';
import type { FileEntry } from './protocol';
import './App.css';

interface Props {
  mnemonic: string;
  ws: WebSocket;
}

type Tab = 'files' | 'devices';

// ─── Device type (matches trusted.json shape) ─────────────────────────────────
interface Device {
  publicKey: string;
  nombre:    string;
  agregadoEl: string;
}

export default function HomeScreen({ ws }: Props) {
  const [tab, setTab] = useState<Tab>('files');

  return (
    <div className="hs-root">
      <aside className="hs-sidebar">
        <div className="hs-logo">⬡ ShardSafe</div>

        <nav className="hs-nav">
          <button
            className={`hs-nav-item ${tab === 'files' ? 'hs-nav-active' : ''}`}
            onClick={() => setTab('files')}
          >
            📁 All files
          </button>
          <button
            className={`hs-nav-item ${tab === 'devices' ? 'hs-nav-active' : ''}`}
            onClick={() => setTab('devices')}
          >
            💻 Devices
          </button>
        </nav>
      </aside>

      <main className="hs-main">
        {tab === 'files'   && <FilesView   ws={ws} />}
        {tab === 'devices' && <DevicesView ws={ws} />}
      </main>
    </div>
  );
}


// ═════════════════════════════════════════════════════════════════════════════
// FILES VIEW
// ═════════════════════════════════════════════════════════════════════════════

function FilesView({ ws }: { ws: WebSocket }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { connected, p2pReady, files, loading, uploadFile, deleteFile, loadAll, downloadFile } = useP2P(ws);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = (reader.result as string).split(',')[1];
      try {
        await uploadFile(`/${file.name}`, base64);
      } catch {
        alert('Upload failed — is the P2P server running?');
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleDelete = async (path: string) => {
    if (!confirm(`Delete ${path}?`)) return;
    await deleteFile(path).catch(console.error);
  };

  const handleDownload = async (path: string) => {
    downloadFile(path)
      .then(file => {
        console.log(file, file.file.base64);
        const blob = new Blob([Uint8Array.from(atob(file.file.base64), c => c.charCodeAt(0))]);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = path.split('/').pop() ?? 'file';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      })
      .catch((e) => {
        console.log(e);
        alert('Download failed — is the P2P server running?');
      });
  };


  return (
    <>
      <div className="hs-header">
        <div>
          <h1 className="hs-title">All files</h1>
          <div className="hs-status">
            <div className={`hs-dot ${connected ? 'hs-dot-on' : 'hs-dot-off'}`} />
            <span>{connected ? (p2pReady ? 'P2P active' : 'Connecting...') : 'Server offline'}</span>
          </div>
        </div>
        <div className="hs-header-actions">
          <button className="hs-btn-ghost" onClick={loadAll} disabled={loading}>↻ Refresh</button>
          <button className="hs-btn-primary" onClick={() => fileInputRef.current?.click()}>
            + Upload
          </button>
          <input ref={fileInputRef} type="file" style={{ display: 'none' }} onChange={handleUpload} />
        </div>
      </div>

      {files.length === 0 ? (
        <div className="hs-empty">
          <p>No files yet.</p>
          <p className="hs-empty-sub">Upload a file or wait for peers to sync.</p>
        </div>
      ) : (
        <div className="hs-grid">
          {files.map(file => (
            <FileCard key={file.path} file={file} onDownload={() => handleDownload(file.path.split('/').pop() ?? file.path)} onDelete={() => handleDelete(file.path)} />
          ))}
        </div>
      )}
    </>
  );
}

function FileCard({ file, onDelete, onDownload }: { file: FileEntry; onDelete: () => void; onDownload: () => void }) {
  const ext  = file.path.split('.').pop()?.toUpperCase() ?? 'FILE';
  const name = file.path.split('/').pop() ?? file.path;
  return (
    <div className="hs-card" onClick={onDownload}>
      <div className="hs-card-icon">{ext}</div>
      <div className="hs-card-info">
        <p className="hs-card-name">{name}</p>
        <p className="hs-card-meta">
          {formatSize(file.size)} · {new Date(file.timestamp).toLocaleDateString()}
        </p>
      </div>
      <button className="hs-card-delete" onClick={onDelete} title="Delete">✕</button>
    </div>
  );
}


// ═════════════════════════════════════════════════════════════════════════════
// DEVICES VIEW
// ═════════════════════════════════════════════════════════════════════════════

function DevicesView({ ws }: { ws: WebSocket }) {
  const [devices, setDevices]       = useState<Device[]>([]);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState('');

  // Add device form
  const [showAdd, setShowAdd]       = useState(false);
  const [newKey, setNewKey]         = useState('');
  const [newName, setNewName]       = useState('');
  const [addLoading, setAddLoading] = useState(false);
  const [addError, setAddError]     = useState('');

  // ── Generic call helper (same pattern as useP2P) ──────────────────────────
  const call = <T = any>(action: string, payload?: any): Promise<T> =>
    new Promise((resolve, reject) => {
      const id = `${action}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const handler = (event: MessageEvent) => {
        let msg: any;
        try { msg = JSON.parse(event.data); } catch { return; }
        if (msg.id !== id) return;
        ws.removeEventListener('message', handler);
        msg.ok ? resolve(msg.result) : reject(new Error(msg.error));
      };
      ws.addEventListener('message', handler);
      ws.send(JSON.stringify({ id, action, payload }));
      setTimeout(() => {
        ws.removeEventListener('message', handler);
        reject(new Error('Timed out'));
      }, 10_000);
    });

  // ── Load devices on mount ─────────────────────────────────────────────────
  const loadDevices = async () => {
    setLoading(true);
    setError('');
    try {
      const result = await call<{ devices: Device[] }>('listDevices');
      setDevices(result.devices);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadDevices(); }, []);

  // ── Add device ────────────────────────────────────────────────────────────
  const handleAdd = async () => {
    if (!newKey.trim() || !newName.trim()) {
      setAddError('Both public key and name are required.');
      return;
    }
    setAddLoading(true);
    setAddError('');
    try {
      await call('addDevice', { publicKey: newKey.trim(), nombre: newName.trim() });
      setNewKey('');
      setNewName('');
      setShowAdd(false);
      await loadDevices();
    } catch (e: any) {
      setAddError(e.message);
    } finally {
      setAddLoading(false);
    }
  };

  // ── Remove device ─────────────────────────────────────────────────────────
  const handleRemove = async (publicKey: string, nombre: string) => {
    if (!confirm(`Remove "${nombre}" from trusted devices?`)) return;
    try {
      await call('removeDevice', { publicKey });
      setDevices(prev => prev.filter(d => d.publicKey !== publicKey));
    } catch (e: any) {
      alert(`Failed to remove device: ${e.message}`);
    }
  };

  return (
    <>
      <div className="hs-header">
        <div>
          <h1 className="hs-title">Trusted devices</h1>
          <p className="hs-subtitle">Devices that can access your files</p>
        </div>
        <div className="hs-header-actions">
          <button className="hs-btn-ghost" onClick={loadDevices} disabled={loading}>
            ↻ Refresh
          </button>
          <button className="hs-btn-primary" onClick={() => { setShowAdd(true); setAddError(''); }}>
            + Add device
          </button>
        </div>
      </div>

      {/* ── Add device panel ── */}
      {showAdd && (
        <div className="dv-add-panel">
          <h3 className="dv-add-title">Add trusted device</h3>
          <p className="dv-add-sub">
            Ask the other device to share its public key with you.
          </p>
          <div className="dv-add-fields">
            <div className="dv-field">
              <label className="dv-label">Device name</label>
              <input
                className="dv-input"
                placeholder="e.g. MacBook Work, iPhone"
                value={newName}
                onChange={e => setNewName(e.target.value)}
              />
            </div>
            <div className="dv-field">
              <label className="dv-label">Public key</label>
              <input
                className="dv-input dv-input-mono"
                placeholder="Paste public key hex..."
                value={newKey}
                onChange={e => setNewKey(e.target.value)}
              />
            </div>
          </div>
          {addError && <p className="dv-error">{addError}</p>}
          <div className="dv-add-actions">
            <button className="hs-btn-ghost" onClick={() => setShowAdd(false)}>Cancel</button>
            <button className="hs-btn-primary" onClick={handleAdd} disabled={addLoading}>
              {addLoading ? 'Adding...' : 'Add device'}
            </button>
          </div>
        </div>
      )}

      {/* ── Device list ── */}
      {error && <p className="dv-error" style={{ marginTop: 16 }}>{error}</p>}

      {loading ? (
        <div className="hs-empty"><p>Loading devices...</p></div>
      ) : devices.length === 0 ? (
        <div className="hs-empty">
          <p>No trusted devices yet.</p>
          <p className="hs-empty-sub">Add a device to start sharing files.</p>
        </div>
      ) : (
        <div className="dv-list">
          {devices.map(device => (
            <DeviceCard
              key={device.publicKey}
              device={device}
              onRemove={() => handleRemove(device.publicKey, device.nombre)}
            />
          ))}
        </div>
      )}
    </>
  );
}

function DeviceCard({ device, onRemove }: { device: Device; onRemove: () => void }) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard.writeText(device.publicKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="dv-card">
      <div className="dv-card-icon">💻</div>
      <div className="dv-card-info">
        <p className="dv-card-name">{device.nombre}</p>
        <p className="dv-card-key" title={device.publicKey}>
          {device.publicKey.slice(0, 12)}...{device.publicKey.slice(-8)}
        </p>
        <p className="dv-card-date">
          Added {new Date(device.agregadoEl).toLocaleDateString()}
        </p>
      </div>
      <div className="dv-card-actions">
        <button className="dv-btn-copy" onClick={copy} title="Copy public key">
          {copied ? '✓' : '⎘'}
        </button>
        <button className="dv-btn-remove" onClick={onRemove} title="Remove device">
          Remove
        </button>
      </div>
    </div>
  );
}


// ─── Utils ────────────────────────────────────────────────────────────────────
function formatSize(bytes: number): string {
  if (bytes < 1024)        return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}