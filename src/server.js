// server/server.js
//
// Run with: node server/server.js
// Add to package.json: "server": "node server/server.js"
//
// npm install ws

import { WebSocketServer } from 'ws';
import { registrarUsuario } from './server/prueba-auth.js';
import { verificarPassword } from './server/prueba-auth.js';
import { agregarDispositivo, eliminarDispositivo, listarDispositivos } from './server/trusted.js';
import { xifrarIDistribuir } from "./server/emisor.js";
import './server/receptor.js' // This file handles incoming ID 5 messages and saves files to disk


// ─── Import your P2P engine functions ────────────────────────────────────────
// Uncomment these when p2pEngine is ready:
// import { initP2P, uploadFile, downloadFile, listFiles, deleteFile, addWriter } from '../lib/p2pEngine.js'
// import { deriveIdentityFromMnemonic } from '../lib/identityEngine.js'

const PORT = 8080;
const wss  = new WebSocketServer({ port: PORT });

console.log(`ShardSafe server running on ws://localhost:${PORT}`);

// ─── Track the single connected client (one app instance) ─────────────────────
let client = null;

// ─── Helper: push an event to the React app unprompted ────────────────────────
// Call this from your P2P engine when something happens:
//   push({ event: 'file:added', data: { file } })
//   push({ event: 'peer:joined', data: { peerKey } })
export function push(message) {
  if (client?.readyState === 1) { // 1 = OPEN
    client.send(JSON.stringify(message));
  }
}

// ─── Helper: reply to a specific request ──────────────────────────────────────
function reply(ws, id, payload) {
  ws.send(JSON.stringify({ id, ...payload }));
}

function replyOk(ws, id, result = {}) {
  reply(ws, id, { ok: true, result });
}

function replyError(ws, id, error) {
  reply(ws, id, { ok: false, error });
}

// ─── Connection handler ────────────────────────────────────────────────────────
wss.on('connection', (ws) => {
  console.log('React app connected');
  client = ws;

  ws.on('message', async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      console.error('Received non-JSON message');
      return;
    }

    const { id, action, payload } = msg;

    if (!id || !action) {
      console.error('Message missing id or action:', msg);
      return;
    }

    console.log(`→ ${action}`, payload ?? '');

    try {
      await dispatch(ws, id, action, payload ?? {});
    } catch (err) {
      console.error(`Error handling '${action}':`, err);
      replyError(ws, id, err.message ?? 'Unknown error');
    }
  });

  ws.on('close', () => {
    console.log('React app disconnected');
    client = null;
  });

  ws.on('error', (err) => {
    console.error('WebSocket error:', err);
  });
});

// ─── Dispatch ─────────────────────────────────────────────────────────────────
// Each case maps to a p2pEngine function.
// Right now they return mock data so you can build the UI without P2P ready.

let identity = null;
let p2pReady = false;

async function dispatch(ws, id, action, payload) {
  switch (action) {

    // ── init: React sends the mnemonic on startup ─────────────────────────────
    // Server derives keys and starts Hyperswarm
    case 'init': {
      const { mnemonic } = payload;
      if (!mnemonic) { replyError(ws, id, 'mnemonic required'); return; }

      // TODO: replace mock with real implementation:
      // identity = await deriveIdentityFromMnemonic(mnemonic)
      // await initP2P(identity)
      // p2pReady = true

      // Mock:
      identity = { mnemonic };
      p2pReady = true;
      console.log('Identity set from mnemonic');

      replyOk(ws, id, { message: 'P2P initialised' });

      // Push p2p:ready so the UI can show "connected" state
      setTimeout(() => push({ event: 'p2p:ready' }), 500);
      break;
    }




    case 'register': {
        const { mnemonic } = payload;
        registrarUsuario(mnemonic);
        replyOk(ws, id, { message: 'Usuario registrado' });
        break;
    }

    // ── loadAll: return all files in the P2P drive ────────────────────────────
    case 'loadAll': {
      // TODO: const files = await listFiles()
      // Mock:
      const files = [
        { path: '/photos/cat.jpg',   author: 'abc123', timestamp: Date.now() - 10000, size: 204800 },
        { path: '/docs/report.pdf',  author: 'abc123', timestamp: Date.now() - 50000, size: 512000 },
      ];
      replyOk(ws, id, { files });
      break;
    }

    // ── upload: encrypt + shard + write to P2P drive ──────────────────────────
    case 'upload': {
      const { path, fileBase64 } = payload;
      if (!path || !fileBase64) { replyError(ws, id, 'path and fileBase64 required'); return; }

      await xifrarIDistribuir(path, fileBase64);
        const file = { path, author: 'me', timestamp: Date.now(), size: fileBase64.length };
      replyOk(ws, id, { file });

      // Push to React so the file list updates in real time without re-fetching
      push({ event: 'file:added', data: { file } });
      break;
    }

    // ── delete: remove from P2P drive ────────────────────────────────────────
    case 'delete': {
      const { path } = payload;
      if (!path) { replyError(ws, id, 'path required'); return; }

      // TODO: await deleteFile(path, identity)

      replyOk(ws, id);

      // Push so all open windows remove it immediately
      push({ event: 'file:deleted', data: { path } });
      break;
    }

    // ── getWriterKey: return this device's writer key so friends can add us ───
    case 'getWriterKey': {
      // TODO: const writerKey = myCore.key.toString('hex')
      const writerKey = 'mock-writer-key-hex-abc123';
      replyOk(ws, id, { writerKey });
      break;
    }

    // ── addWriter: grant a friend write access ────────────────────────────────
    case 'addWriter': {
      const { writerKeyHex } = payload;
      if (!writerKeyHex) { replyError(ws, id, 'writerKeyHex required'); return; }

      // TODO: await addWriter(writerKeyHex, identity)
      replyOk(ws, id);
      break;
    }

    // ── revokeDevice: remove a writer from Autobase ───────────────────────────
    case 'revokeDevice': {
      const { writerKeyHex } = payload;
      if (!writerKeyHex) { replyError(ws, id, 'writerKeyHex required'); return; }

      // TODO: await revokeWriter(writerKeyHex, identity)
      replyOk(ws, id);
      break;
    }



    // Add these cases to your dispatch() switch in server.js
// Make sure to import trusted.js at the top:
//
//   const { agregarDispositivo, eliminarDispositivo, listarDispositivos } = require('./trusted.js');
//
// And change listarDispositivos() to return the data instead of console.log it:
// (see updated trusted.js below)

// ─── Paste these cases into your existing switch(action) ─────────────────────

    case 'listDevices': {
      // Returns all trusted devices as an array
      const devices = listarDispositivos();
      replyOk(ws, id, { devices });
      break;
    }

    case 'addDevice': {
      const { publicKey, nombre } = payload;
      if (!publicKey || !nombre) {
        replyError(ws, id, 'publicKey and nombre are required');
        break;
      }
      agregarDispositivo(publicKey, nombre);
      replyOk(ws, id, { message: `Device '${nombre}' added` });
      break;
    }

    case 'removeDevice': {
      const { publicKey } = payload;
      if (!publicKey) {
        replyError(ws, id, 'publicKey is required');
        break;
      }
      const removed = eliminarDispositivo(publicKey);
      if (removed) {
        replyOk(ws, id, { message: 'Device removed' });
      } else {
        replyError(ws, id, 'Device not found');
      }
      break;
    }


    default:
      replyError(ws, id, `Unknown action: ${action}`);
  }
}