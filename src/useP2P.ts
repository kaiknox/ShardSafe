// useP2P.ts
//
// Accepts an already-open WebSocket from App.tsx (which registered first).
// Handles request/response matching by id, and server push events.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { FileEntry, ServerMessage } from './protocol';
import { isPush, isResponse } from './protocol';

type PendingMap = Map<string, {
  resolve: (v: any) => void;
  reject:  (e: Error) => void;
}>;

export function useP2P(ws: WebSocket) {
  const [connected, setConnected] = useState(ws.readyState === WebSocket.OPEN);
  const [p2pReady,  setP2pReady]  = useState(false);
  const [files,     setFiles]     = useState<FileEntry[]>([]);
  const [loading,   setLoading]   = useState(false);

  const pendingRef = useRef<PendingMap>(new Map());

  // ── Send a request, return a promise that resolves when server replies ─────
  const call = useCallback(<T = any>(action: string, payload?: any): Promise<T> => {
    return new Promise((resolve, reject) => {
      if (ws.readyState !== WebSocket.OPEN) {
        reject(new Error('WebSocket is not open'));
        return;
      }

      // Unique id so concurrent calls don't collide
      const id = `${action}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      pendingRef.current.set(id, { resolve, reject });

      ws.send(JSON.stringify({ id, action, payload }));

      // Timeout after 15s
      setTimeout(() => {
        if (pendingRef.current.has(id)) {
          pendingRef.current.delete(id);
          reject(new Error(`'${action}' timed out`));
        }
      }, 15_000);
    });
  }, [ws]);

  // ── Wire up message handler on the shared ws ───────────────────────────────
  useEffect(() => {
    const onOpen = () => setConnected(true);
    const onClose = () => {
      setConnected(false);
      setP2pReady(false);
      // Reject all pending requests
      for (const [, p] of pendingRef.current) {
        p.reject(new Error('WebSocket disconnected'));
      }
      pendingRef.current.clear();
    };

    const onMessage = (event: MessageEvent) => {
      let msg: ServerMessage;
      try { msg = JSON.parse(event.data); } catch { return; }

      // Response to one of our requests
      if (isResponse(msg)) {
        const pending = pendingRef.current.get(msg.id);
        if (!pending) return; // belongs to a different handler (e.g. register in App.tsx)
        pendingRef.current.delete(msg.id);
        msg.ok ? pending.resolve((msg as any).result) : pending.reject(new Error((msg as any).error));
        return;
      }

      // Server push — update state without us asking
      if (isPush(msg)) {
        switch (msg.event) {
          case 'p2p:ready':
            setP2pReady(true);
            break;
          case 'file:added':
            setFiles(prev =>
              prev.some(f => f.path === msg.data.file.path)
                ? prev
                : [msg.data.file, ...prev]
            );
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
    };

    ws.addEventListener('open',    onOpen);
    ws.addEventListener('close',   onClose);
    ws.addEventListener('message', onMessage);

    // Load files immediately
    call<{ files: FileEntry[] }>('loadAll')
      .then(r => setFiles(r.files))
      .catch(e => console.error('loadAll failed:', e));

    return () => {
      ws.removeEventListener('open',    onOpen);
      ws.removeEventListener('close',   onClose);
      ws.removeEventListener('message', onMessage);
    };
  }, [ws, call]);

  // ── Public actions ─────────────────────────────────────────────────────────
  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const r = await call<{ files: FileEntry[] }>('loadAll');
      setFiles(r.files);
    } finally {
      setLoading(false);
    }
  }, [call]);

  const uploadFile = useCallback((path: string, fileBase64: string) =>
    call('upload', { path, fileBase64 }), [call]);

  const deleteFile = useCallback((path: string) =>
    call('delete', { path }), [call]);

  const addWriter = useCallback((writerKeyHex: string) =>
    call('addWriter', { writerKeyHex }), [call]);

  const revokeDevice = useCallback((writerKeyHex: string) =>
    call('revokeDevice', { writerKeyHex }), [call]);

  const getWriterKey = useCallback(async (): Promise<string> => {
    const r = await call<{ writerKey: string }>('getWriterKey');
    return r.writerKey;
  }, [call]);

  return {
    connected, p2pReady, files, loading,
    loadAll, uploadFile, deleteFile, addWriter, revokeDevice, getWriterKey,
  };
}