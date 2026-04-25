// lib/useP2P.ts
//
// React hook that manages the WebSocket connection to server.js.
//
// Usage:
//   const { files, loading, connected, uploadFile, deleteFile } = useP2P(mnemonic)
//
// Features:
//   - Auto-connects when mnemonic is available
//   - Request/response with unique IDs (no collision between concurrent calls)
//   - Server push updates the file list in real time
//   - Auto-reconnects if the server restarts

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ClientRequest,
  FileEntry,
  ServerMessage,
} from './protocol';
import { isPush, isResponse } from './protocol';

const SERVER_URL = 'ws://localhost:8080';
const RECONNECT_DELAY_MS = 2000;

// ─── Pending request map ──────────────────────────────────────────────────────
type PendingMap = Map<string, { resolve: (v: any) => void; reject: (e: Error) => void }>;

// ─── Hook ─────────────────────────────────────────────────────────────────────
export function useP2P(mnemonic: string | null) {
  const [connected, setConnected]   = useState(false);
  const [p2pReady, setP2pReady]     = useState(false);
  const [files, setFiles]           = useState<FileEntry[]>([]);
  const [loading, setLoading]       = useState(false);

  const wsRef      = useRef<WebSocket | null>(null);
  const pendingRef = useRef<PendingMap>(new Map());
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Core: send a request and wait for the matching response ────────────────
  const call = useCallback(<T = any>(
    action: ClientRequest['action'],
    payload?: any,
  ): Promise<T> => {
    return new Promise((resolve, reject) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        reject(new Error('Not connected to P2P server'));
        return;
      }

      const id = `${action}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

      pendingRef.current.set(id, { resolve, reject });

      ws.send(JSON.stringify({ id, action, payload }));

      // Timeout — prevents hanging promises if server never responds
      setTimeout(() => {
        if (pendingRef.current.has(id)) {
          pendingRef.current.delete(id);
          reject(new Error(`Request '${action}' timed out`));
        }
      }, 15_000);
    });
  }, []);

  // ── Handle incoming messages ───────────────────────────────────────────────
  const handleMessage = useCallback((msg: ServerMessage) => {
    // Response to one of our requests
    if (isResponse(msg)) {
      const pending = pendingRef.current.get(msg.id);
      if (!pending) return;
      pendingRef.current.delete(msg.id);

      if (msg.ok) {
        pending.resolve(msg.result);
      } else {
        pending.reject(new Error(msg.error));
      }
      return;
    }

    // Server push — update state without us asking
    if (isPush(msg)) {
      switch (msg.event) {
        case 'p2p:ready':
          setP2pReady(true);
          break;

        case 'file:added':
          // Add new file to list — avoid duplicates
          setFiles(prev => {
            const exists = prev.some(f => f.path === msg.data.file.path);
            return exists ? prev : [msg.data.file, ...prev];
          });
          break;

        case 'file:deleted':
          setFiles(prev => prev.filter(f => f.path !== msg.data.path));
          break;

        case 'peer:joined':
          console.log('Peer joined:', msg.data.peerKey.slice(0, 8));
          break;

        case 'peer:left':
          console.log('Peer left:', msg.data.peerKey.slice(0, 8));
          break;
      }
    }
  }, []);

  // ── Connect + reconnect loop ───────────────────────────────────────────────
  const connect = useCallback(() => {
    if (!mnemonic) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(SERVER_URL);
    wsRef.current = ws;

    ws.onopen = async () => {
      console.log('Connected to P2P server');
      setConnected(true);

      // Send mnemonic so server can init P2P
      try {
        await call('init', { mnemonic });
        console.log('P2P initialised');
      } catch (e) {
        console.error('Init failed:', e);
      }

      // Load initial file list
      try {
        const result = await call<{ files: FileEntry[] }>('loadAll');
        setFiles(result.files);
      } catch (e) {
        console.error('loadAll failed:', e);
      }
    };

    ws.onmessage = (event) => {
      let msg: ServerMessage;
      try { msg = JSON.parse(event.data); } catch { return; }
      handleMessage(msg);
    };

    ws.onclose = () => {
      console.log('Disconnected — reconnecting in 2s...');
      setConnected(false);
      setP2pReady(false);
      wsRef.current = null;

      // Reject all pending requests
      for (const [, pending] of pendingRef.current) {
        pending.reject(new Error('WebSocket disconnected'));
      }
      pendingRef.current.clear();

      // Auto-reconnect
      reconnectRef.current = setTimeout(connect, RECONNECT_DELAY_MS);
    };

    ws.onerror = (err) => {
      console.error('WebSocket error:', err);
    };
  }, [mnemonic, call, handleMessage]);

  // ── Connect on mount / mnemonic change ────────────────────────────────────
  useEffect(() => {
    if (!mnemonic) return;
    connect();
    return () => {
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      wsRef.current?.close();
    };
  }, [mnemonic, connect]);

  // ── Public API ─────────────────────────────────────────────────────────────

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const result = await call<{ files: FileEntry[] }>('loadAll');
      setFiles(result.files);
      return result.files;
    } finally {
      setLoading(false);
    }
  }, [call]);

  const uploadFile = useCallback(async (path: string, fileBase64: string) => {
    return call('upload', { path, fileBase64 });
  }, [call]);

  const deleteFile = useCallback(async (path: string) => {
    return call('delete', { path });
  }, [call]);

  const addWriter = useCallback(async (writerKeyHex: string) => {
    return call('addWriter', { writerKeyHex });
  }, [call]);

  const revokeDevice = useCallback(async (writerKeyHex: string) => {
    return call('revokeDevice', { writerKeyHex });
  }, [call]);

  const getWriterKey = useCallback(async (): Promise<string> => {
    const result = await call<{ writerKey: string }>('getWriterKey');
    return result.writerKey;
  }, [call]);

  return {
    // State
    connected,   // WebSocket is open
    p2pReady,    // Hyperswarm is running
    files,       // current file list — updates in real time via push events
    loading,

    // Actions
    loadAll,
    uploadFile,
    deleteFile,
    addWriter,
    revokeDevice,
    getWriterKey,
  };
}
