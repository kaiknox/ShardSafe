/**
 * lib/p2pEngine.js — ShardSafe
 *
 * Run this in Node.js (not directly in React Native).
 * Expose it to your RN app via a local WebSocket bridge (see bottom of file).
 *
 * Install:
 *   npm install autobase corestore hyperswarm hyperbee b4a
 */

import Autobase from 'autobase';
import b4a from 'b4a';
import Corestore from 'corestore';
import * as SecureStore from 'expo-secure-store'; // swap for 'node:fs' if pure Node
import Hyperbee from 'hyperbee';
import Hyperswarm from 'hyperswarm';

// ─── Operation types ──────────────────────────────────────────────────────────
const OP_UPLOAD = 'upload';
const OP_DELETE = 'delete';
const OP_SHARE  = 'share';

// ─── Module state ─────────────────────────────────────────────────────────────
let store = null;
let swarm = null;
let base  = null;
let view  = null;


// ═════════════════════════════════════════════════════════════════════════════
// A. INITIALISE
// ═════════════════════════════════════════════════════════════════════════════

export async function initP2P(identity, storagePath = './shardsafe-data') {

  // A1. Corestore — manages all Hypercores on disk
  store = new Corestore(storagePath);

  // ── FIX 1: tie myCore to your actual keypair ──────────────────────────────
  // Previously used { name: 'my-writes' } which is just a local label.
  // That means a restored device would get a DIFFERENT Hypercore key
  // even with the same mnemonic — breaking multi-device sync.
  //
  // By passing the keypair from identityEngine, the same mnemonic always
  // produces the same Hypercore key on every device.
  const myCore = store.get({
    keyPair: {
      publicKey: identity.publicKey,   // 32-byte Uint8Array from identityEngine
      secretKey: identity.privateKey,  // 32-byte Uint8Array from identityEngine
    }
  });
  await myCore.ready();

  console.log('My writer key:', b4a.toString(myCore.key, 'hex'));
  // Share this with friends so they can add you as a writer


  // A2. Autobase — merges all writers' Hypercores into one view
  base = new Autobase(store, myCore.key, {
    open:  openView,
    apply: applyOperations,
  });
  await base.ready();

  view = base.view; // the merged Hyperbee — query this for file listings

  // A3. Hyperswarm — peer discovery and connections
  swarm = new Hyperswarm();

  swarm.on('connection', (peer) => {
    console.log('Peer connected:', b4a.toString(peer.remotePublicKey, 'hex').slice(0, 8));

    // Replicate all Hypercores with this peer (Autobase-managed + yours)
    store.replicate(peer);

    // ── FIX 2: wire up shard messaging protocol ───────────────────────────
    // Previously setupPeerProtocol was defined but never called.
    // Without this, peers can sync file metadata but cannot exchange shards,
    // meaning no one can ever decrypt anything.
    setupPeerProtocol(peer);
  });


  // A4. Announce to DHT using your discovery key
  // Both your devices derive the same discoveryKey → they find each other
  // Friends use a separate shared topic (see addWriter)
  swarm.join(b4a.from(identity.discoveryKey), { server: true, client: true });

  // Reload any writers that were previously granted access
  await base.ready();
  await reloadWriters();

  console.log('P2P ready. Listening for peers...');
  return { base, view, myCore };
}


// ═════════════════════════════════════════════════════════════════════════════
// B. MERGED VIEW — what the database looks like
// ═════════════════════════════════════════════════════════════════════════════

function openView(core) {
  // Hyperbee = sorted key-value store built on Hypercore
  // Keys:   file paths like "/photos/cat.jpg" or "writers/abc123"
  // Values: JSON metadata objects
  return new Hyperbee(core, {
    keyEncoding:   'utf-8',
    valueEncoding: 'json',
  });
}


// ═════════════════════════════════════════════════════════════════════════════
// C. APPLY OPERATIONS — how each operation updates the merged view
// ═════════════════════════════════════════════════════════════════════════════

async function applyOperations(bee, batch, clocks) {
  const b = bee.batch(); // atomic — all writes apply together or not at all

  for (const node of batch) {
    let op;
    try {
      op = JSON.parse(b4a.toString(node.value));
    } catch {
      continue; // skip malformed entries silently
    }

    if (op.type === OP_UPLOAD) {
      // ── FIX 3: shards are NOT stored in the shared view ─────────────────
      // Old code put shards: op.shards here, meaning all shards were
      // visible to every peer — defeating the entire point of sharding.
      //
      // The view only stores:
      //   - encryptedPayload: the encrypted file (safe to share, unreadable without key)
      //   - metadata: path, author, timestamp, size
      //
      // Shards travel separately peer-to-peer via setupPeerProtocol,
      // and are stored locally in SecureStore on each device.
      await b.put(op.path, {
        path:             op.path,
        encryptedPayload: op.encryptedPayload, // { ciphertext, iv, tag }
        author:           op.author,
        timestamp:        op.timestamp,
        size:             op.size,
      });
    }

    else if (op.type === OP_DELETE) {
      await b.del(op.path);
    }

    else if (op.type === OP_SHARE) {
      // Store granted writer so ALL devices can reload them on startup
      await b.put(`writers/${op.writerKey}`, {
        writerKey: op.writerKey,
        grantedBy: op.author,
        grantedAt: op.timestamp,
      });
    }
  }

  await b.flush();
}


// ═════════════════════════════════════════════════════════════════════════════
// D. SHARD PROTOCOL — peer-to-peer shard exchange over Hyperswarm connections
// ═════════════════════════════════════════════════════════════════════════════
//
// Hyperswarm connections are raw duplex streams — you can send any binary data.
// We build a simple JSON-lines protocol on top (one JSON object per line).
//
// Message types:
//   shard          → "here is a shard for you to hold"
//   shard-request  → "I need my shard for this file"
//   shard-response → "here is the shard you requested"

// ── FIX 4: request IDs prevent shard response collisions ──────────────────
// Old code: one generic data listener that would fire for ANY data on the peer.
// If two concurrent downloads both requested shards, the wrong handler
// could pick up the wrong file's shard.
//
// Fix: each request gets a unique ID, response must echo it back.
// The handler only resolves when it sees its own ID.

const pendingShardRequests = new Map(); // requestId → { resolve, reject, filePath }

function setupPeerProtocol(peer) {
  let buffer = '';

  peer.on('data', async (chunk) => {
    buffer += chunk.toString();

    // Split on newlines — each complete line is one message
    const lines = buffer.split('\n');
    buffer = lines.pop(); // keep incomplete last line for next chunk

    for (const line of lines) {
      if (!line.trim()) continue;

      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }

      if (msg.protocol !== 'shardsafe') continue;

      // ── Incoming: a peer is sending us a shard to hold ──────────────────
      if (msg.type === 'shard') {
        await storeShard(msg.filePath, msg.shard);
        console.log(`Stored shard from peer for: ${msg.filePath}`);
      }

      // ── Incoming: a peer is requesting their shard back ─────────────────
      else if (msg.type === 'shard-request') {
        const shard = await loadShard(msg.filePath);
        if (shard) {
          sendMessage(peer, {
            protocol:  'shardsafe',
            type:      'shard-response',
            requestId: msg.requestId, // echo back so sender matches response
            filePath:  msg.filePath,
            shard,
          });
        }
      }

      // ── Incoming: response to our shard request ──────────────────────────
      else if (msg.type === 'shard-response') {
        const pending = pendingShardRequests.get(msg.requestId);
        if (pending) {
          pendingShardRequests.delete(msg.requestId);
          pending.resolve(msg.shard);
        }
      }
    }
  });

  peer.on('close', () => {
    // Reject any pending requests that were waiting on this peer
    for (const [id, pending] of pendingShardRequests) {
      if (pending.peer === peer) {
        pendingShardRequests.delete(id);
        pending.reject(new Error('Peer disconnected before shard response'));
      }
    }
  });
}

function sendMessage(peer, obj) {
  // Newline-delimited JSON — simple, debuggable, no binary framing needed
  peer.write(Buffer.from(JSON.stringify(obj) + '\n'));
}


// ═════════════════════════════════════════════════════════════════════════════
// E. SHARD STORAGE — one SecureStore key per file
// ═════════════════════════════════════════════════════════════════════════════
//
// ── FIX 5: per-file SecureStore keys instead of one shared JSON blob ───────
// Old code loaded one big JSON object, mutated it, and saved it back.
// Race condition: two concurrent uploads could overwrite each other's shard.
//
// Fix: each file gets its own SecureStore entry.
// Reads and writes are independent — no race condition possible.

function shardKey(filePath) {
  // SecureStore keys cannot contain slashes
  return `shardsafe.shard.${filePath.replace(/\//g, '__')}`;
}

async function storeShard(filePath, shard) {
  await SecureStore.setItemAsync(shardKey(filePath), shard);
}

async function loadShard(filePath) {
  return SecureStore.getItemAsync(shardKey(filePath));
}

async function deleteShard(filePath) {
  await SecureStore.deleteItemAsync(shardKey(filePath));
}


// ═════════════════════════════════════════════════════════════════════════════
// F. UPLOAD — encrypt, shard, store, distribute
// ═════════════════════════════════════════════════════════════════════════════

export async function uploadFile(filePath, fileBase64, identity, encryptAndShard) {
  // 1. Encrypt file and split the master key into 3 shards (need 2 to decrypt)
  //    Each call generates a fresh random master key — per-file isolation
  const { encryptedPayload, shards } = encryptAndShard(fileBase64, 3, 2);

  // 2. Write metadata to Autobase — synced to ALL connected peers
  //    encryptedPayload is safe to share: it's scrambled bytes, useless without shards
  const op = {
    type:             OP_UPLOAD,
    path:             filePath,
    encryptedPayload,            // { ciphertext, iv, tag }
    author:           b4a.toString(b4a.from(identity.publicKey), 'hex'),
    timestamp:        Date.now(),
    size:             fileBase64.length,
  };
  await base.append(b4a.from(JSON.stringify(op)));

  // 3. Keep shard[0] for yourself locally
  await storeShard(filePath, shards[0]);

  // 4. Distribute shard[1] and shard[2] to connected peers
  //    Each peer stores their shard — they become part of your recovery network
  const peers = [...swarm.connections];

  if (peers.length === 0) {
    // No peers online — store all shards locally as fallback
    // You won't have distributed security but the file is still encrypted
    console.warn('No peers connected — storing all shards locally as fallback');
    await storeShard(filePath + '.shard1', shards[1]);
    await storeShard(filePath + '.shard2', shards[2]);
    return;
  }

  // Send shard[1] to first peer
  sendMessage(peers[0], {
    protocol: 'shardsafe',
    type:     'shard',
    filePath,
    shard:    shards[1],
  });

  // Send shard[2] to second peer (or first peer again if only one connected)
  const secondPeer = peers[1] ?? peers[0];
  sendMessage(secondPeer, {
    protocol: 'shardsafe',
    type:     'shard',
    filePath,
    shard:    shards[2],
  });

  console.log(`Uploaded ${filePath} — shards distributed to ${peers.length} peer(s)`);
}


// ═════════════════════════════════════════════════════════════════════════════
// G. DOWNLOAD — fetch encrypted file, collect shards, decrypt
// ═════════════════════════════════════════════════════════════════════════════

export async function downloadFile(filePath, reconstructAndDecrypt) {
  // 1. Get encrypted file metadata from the merged Autobase view
  //    This is already synced to this device — no network request needed
  const entry = await view.get(filePath);
  if (!entry) throw new Error(`File not found: ${filePath}`);

  const { encryptedPayload } = entry.value;

  // 2. Load your own shard from local SecureStore
  const myShard = await loadShard(filePath);
  if (!myShard) throw new Error('Your shard for this file is missing from this device.');

  // 3. Request a second shard from a connected peer
  //    We only need 2 of 3 to reconstruct the master key
  let peerShard;
  try {
    peerShard = await requestShardFromPeer(filePath);
  } catch (e) {
    throw new Error(`Could not get shard from peer: ${e.message}. Is another device online?`);
  }

  // 4. Reconstruct master key from 2 shards → decrypt the file
  const fileBase64 = reconstructAndDecrypt(encryptedPayload, [myShard, peerShard]);
  return fileBase64;
}

function requestShardFromPeer(filePath, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const peers = [...swarm.connections];
    if (peers.length === 0) {
      reject(new Error('No peers connected'));
      return;
    }

    // ── FIX 4 applied: unique request ID ────────────────────────────────
    const requestId = Math.random().toString(36).slice(2) + Date.now().toString(36);
    const peer = peers[0];

    const timeout = setTimeout(() => {
      pendingShardRequests.delete(requestId);
      reject(new Error('Shard request timed out after 10s'));
    }, timeoutMs);

    pendingShardRequests.set(requestId, {
      peer,
      filePath,
      resolve: (shard) => { clearTimeout(timeout); resolve(shard); },
      reject:  (err)   => { clearTimeout(timeout); reject(err); },
    });

    sendMessage(peer, {
      protocol:  'shardsafe',
      type:      'shard-request',
      requestId, // peer echoes this back in shard-response
      filePath,
    });
  });
}


// ═════════════════════════════════════════════════════════════════════════════
// H. FILE LISTING
// ═════════════════════════════════════════════════════════════════════════════

export async function listFiles() {
  const files = [];
  for await (const entry of view.createReadStream({ gt: '/', lt: '/\xff' })) {
    files.push(entry.value);
  }
  return files;
}

export async function getFile(filePath) {
  const entry = await view.get(filePath);
  return entry ? entry.value : null;
}

export async function deleteFile(filePath, identity) {
  const op = {
    type:      OP_DELETE,
    path:      filePath,
    author:    b4a.toString(b4a.from(identity.publicKey), 'hex'),
    timestamp: Date.now(),
  };
  await base.append(b4a.from(JSON.stringify(op)));
  await deleteShard(filePath); // remove your local shard too
}


// ═════════════════════════════════════════════════════════════════════════════
// I. SHARING WITH A FRIEND
// ═════════════════════════════════════════════════════════════════════════════
//
// Flow:
//   1. Friend gives you their writerKey (their myCore.key as hex)
//   2. You call addWriter(friendWriterKeyHex)
//   3. Autobase adds their Hypercore to the merge
//   4. A 'share' operation is written so ALL your devices reload them on startup
//   5. Hyperswarm replicates their Hypercore to everyone
//   6. Their uploads now appear in everyone's file listing

export async function addWriter(friendWriterKeyHex, identity) {
  const writerKey = b4a.from(friendWriterKeyHex, 'hex');

  // Tell Autobase to start merging this writer's Hypercore
  await base.addWriter(writerKey, { indexer: true });

  // Persist the grant so all devices reload it on startup (via reloadWriters)
  const op = {
    type:      OP_SHARE,
    writerKey: friendWriterKeyHex,
    author:    b4a.toString(b4a.from(identity.publicKey), 'hex'),
    timestamp: Date.now(),
  };
  await base.append(b4a.from(JSON.stringify(op)));

  console.log(`Added writer: ${friendWriterKeyHex.slice(0, 8)}...`);
}

// Called on startup — reload any writers that were previously granted
export async function reloadWriters() {
  try {
    for await (const entry of view.createReadStream({ gt: 'writers/', lt: 'writers/\xff' })) {
      const { writerKey } = entry.value;
      const key = b4a.from(writerKey, 'hex');
      await base.addWriter(key, { indexer: true });
    }
  } catch {
    // View may be empty on first run — that's fine
  }
}


// ═════════════════════════════════════════════════════════════════════════════
// J. TEARDOWN
// ═════════════════════════════════════════════════════════════════════════════

export async function closeP2P() {
  await swarm?.destroy();
  await store?.close();
}