// shared/protocol.ts
//
// Single source of truth for all WebSocket messages.
// Import this in both server.js and client.ts so they always agree.
//
// Two patterns:
//   1. Request / Response  — client sends a request with an id,
//                            server replies with the same id
//   2. Server Push         — server sends an event with no id,
//                            client dispatches it to listeners

// ─── File shape ───────────────────────────────────────────────────────────────
export interface FileEntry {
  path:      string;
  author:    string;
  timestamp: number;
  size:      number;
}

// ─────────────────────────────────────────────────────────────────────────────
// CLIENT → SERVER  (requests)
// ─────────────────────────────────────────────────────────────────────────────

export type ClientRequest =
  | { id: string; action: 'init';          payload: { mnemonic: string } }
  | { id: string; action: 'register';      payload: { mnemonic: string } }
  | { id: string; action: 'loadAll';       payload?: never }
  | { id: string; action: 'upload';        payload: { path: string; fileBase64: string } }
  | { id: string; action: 'delete';        payload: { path: string } }
  | { id: string; action: 'revokeDevice';  payload: { writerKeyHex: string } }
  | { id: string; action: 'addWriter';     payload: { writerKeyHex: string } }
  | { id: string; action: 'getWriterKey';  payload?: never }

// ─────────────────────────────────────────────────────────────────────────────
// SERVER → CLIENT  (responses to requests)
// ─────────────────────────────────────────────────────────────────────────────

export type ServerResponse =
  | { id: string; ok: true;  result: LoadAllResult }
  | { id: string; ok: true;  result: UploadResult }
  | { id: string; ok: true;  result: BasicResult }
  | { id: string; ok: false; error: string }

export interface LoadAllResult  { files: FileEntry[] }
export interface UploadResult   { file: FileEntry }
export interface BasicResult    { message?: string }
export interface WriterKeyResult { writerKey: string }

// ─────────────────────────────────────────────────────────────────────────────
// SERVER → CLIENT  (push events — no id, client didn't ask)
// ─────────────────────────────────────────────────────────────────────────────

export type ServerPush =
  | { event: 'file:added';    data: { file: FileEntry } }
  | { event: 'file:deleted';  data: { path: string } }
  | { event: 'peer:joined';   data: { peerKey: string } }
  | { event: 'peer:left';     data: { peerKey: string } }
  | { event: 'p2p:ready';     data?: never }

// ─── Union of everything the server can send ─────────────────────────────────
export type ServerMessage = ServerResponse | ServerPush

// ─── Type guard: is this a push event or a response? ─────────────────────────
export function isPush(msg: ServerMessage): msg is ServerPush {
  return 'event' in msg;
}

export function isResponse(msg: ServerMessage): msg is ServerResponse {
  return 'id' in msg;
}