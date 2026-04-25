// lib/p2pEngine.js
//
// Install:
//   npm install autobase corestore hyperswarm hyperbee b4a
//
// Note: run this in a Node.js process (not directly in React Native).
// For RN, expose this via a local WebSocket or REST bridge.

import Autobase from 'autobase';
import b4a from 'b4a'; // Buffer utilities that work everywhere
import Corestore from 'corestore';
import Hyperbee from 'hyperbee';
import Hyperswarm from 'hyperswarm';

// ─── Operation types ──────────────────────────────────────────────────────────
const OP_UPLOAD = 'upload'
const OP_DELETE = 'delete'
const OP_SHARE  = 'share'

// ─── State ────────────────────────────────────────────────────────────────────
let store   = null   // Corestore — manages all Hypercores
let swarm   = null   // Hyperswarm — manages peer connections
let base    = null   // Autobase — merges all writers
let view    = null   // Hyperbee — the merged file index you query


// ═════════════════════════════════════════════════════════════════════════════
// STEP A: INITIALISE
// ═════════════════════════════════════════════════════════════════════════════
//
// Call this once when the app starts, after loading identity.
//
// identity = { privateKey, publicKey, discoveryKey, encryptionKey }

export async function initP2P(identity, storagePath = './shardsafe-data') {

  // ── A1. Create the Corestore ──────────────────────────────────────────────
  // Corestore manages all Hypercores on disk.
  // The same path always gives you the same cores.
  store = new Corestore(storagePath)


  // ── A2. Get YOUR writable Hypercore ───────────────────────────────────────
  // This is the core only you can write to.
  // 'my-writes' is just a local name — the actual identity is your keypair.
  const myCore = store.get({ name: 'my-writes' })
  await myCore.ready()

  console.log('My writer key:', b4a.toString(myCore.key, 'hex'))
  // → share this key with friends so they can add your core to their Autobase


  // ── A3. Create Autobase ───────────────────────────────────────────────────
  // First argument:  the Corestore (where to store things)
  // Second argument: your local writer core
  // Third argument:  { open, apply } — you define the merge logic
  base = new Autobase(store, myCore.key, {
    open: openView,
    apply: applyOperations,
  })
  await base.ready()

  // base.view is what openView() returns — the merged Hyperbee
  view = base.view


  // ── A4. Set up Hyperswarm ─────────────────────────────────────────────────
  swarm = new Hyperswarm()

  swarm.on('connection', async (peer) => {
    console.log('New peer connected')

    // This one line handles everything:
    // - sends your Hypercore data to the peer
    // - receives their Hypercore data
    // - Autobase automatically picks up new writers and merges them
    store.replicate(peer)
  })


  // ── A5. Announce to DHT ───────────────────────────────────────────────────
  // Both your devices use the same discoveryKey → they find each other.
  // The discoveryKey is derived from your public key in identityEngine.ts.
  swarm.join(identity.discoveryKey, { server: true, client: true })

  console.log('P2P ready. Waiting for peers...')

  return { base, view, myCore }
}


// ═════════════════════════════════════════════════════════════════════════════
// STEP B: DEFINE THE MERGED VIEW (openView)
// ═════════════════════════════════════════════════════════════════════════════
//
// This function is called by Autobase to create the data structure
// that stores the merged result of all operations.
//
// We use Hyperbee — a sorted key-value store built on Hypercore.
// Think of it as a tiny database.
//
// 'core' here is a special Autobase-managed Hypercore for the view.
// You never write to it directly — Autobase does via your apply() function.

function openView(core) {
  return new Hyperbee(core, {
    keyEncoding:   'utf-8',   // file paths are strings: "/photos/cat.jpg"
    valueEncoding: 'json',    // file metadata is JSON
  })
}


// ═════════════════════════════════════════════════════════════════════════════
// STEP C: DEFINE HOW OPERATIONS ARE APPLIED (applyOperations)
// ═════════════════════════════════════════════════════════════════════════════
//
// Autobase calls this with a batch of operations in causal order.
// You decide what each operation does to the merged view.
//
// 'bee'  = the Hyperbee view (from openView)
// 'batch' = array of raw Hypercore nodes to process
// 'clocks' = Autobase internal timing info (you don't need this)

async function applyOperations(bee, batch, clocks) {
  // Open a Hyperbee batch for atomic writes
  // (all changes apply together, like a database transaction)
  const b = bee.batch()

  for (const node of batch) {
    // node.value is a Buffer — parse it back to our operation object
    let op
    try {
      op = JSON.parse(b4a.toString(node.value))
    } catch {
      continue  // skip malformed entries
    }

    if (op.type === OP_UPLOAD) {
      // Store file metadata in the view.
      // The encrypted payload (the actual file bytes) is stored separately.
      // The view just needs to know the file exists and where to find it.
      await b.put(op.path, {
        path:             op.path,
        encryptedPayload: op.encryptedPayload,  // { ciphertext, iv, tag }
        shards:           op.shards,            // SSS shards for key reconstruction
        author:           op.author,            // public key of uploader
        timestamp:        op.timestamp,
        size:             op.size,
      })
    }

    else if (op.type === OP_DELETE) {
      // Remove the file from the view
      await b.del(op.path)
    }

    else if (op.type === OP_SHARE) {
      // A writer is sharing access with a friend.
      // Store the friend's writer key so we can add their core to Autobase.
      // Key format: "writers/<their-public-key-hex>"
      await b.put(`writers/${op.writerKey}`, {
        writerKey:   op.writerKey,
        grantedBy:   op.author,
        grantedAt:   op.timestamp,
      })
    }
  }

  // Flush all changes atomically
  await b.flush()
}


// ═════════════════════════════════════════════════════════════════════════════
// STEP D: WRITING OPERATIONS
// ═════════════════════════════════════════════════════════════════════════════
//
// To write, you append an operation to YOUR Hypercore.
// Autobase picks it up, merges it with others, and calls apply().

export async function uploadFile(path, encryptedPayload, authorPublicKeyHex, sizeBytes) {
  const op = {
    type:             OP_UPLOAD,
    path,                         // e.g. "/photos/cat.jpg"
    encryptedPayload,             // { ciphertext, iv, tag } from cryptoEngine
    author:           authorPublicKeyHex,
    timestamp:        Date.now(),
    size:             sizeBytes,
  }

  // Append to your local Hypercore as a JSON Buffer
  // Autobase sees the new entry → calls applyOperations → updates the view
  await base.append(b4a.from(JSON.stringify(op)))
}

export async function deleteFile(path, authorPublicKeyHex) {
  const op = {
    type:      OP_DELETE,
    path,
    author:    authorPublicKeyHex,
    timestamp: Date.now(),
  }
  await base.append(b4a.from(JSON.stringify(op)))
}


// ═════════════════════════════════════════════════════════════════════════════
// STEP E: READING THE MERGED VIEW
// ═════════════════════════════════════════════════════════════════════════════

// Get metadata for one file
export async function getFile(path) {
  const node = await view.get(path)
  return node ? node.value : null
}

// List all files
export async function listFiles() {
  const files = []
  // Hyperbee.createReadStream() iterates all keys in sorted order
  // { gt: '/', lt: '/~' } means "everything that looks like a file path"
  for await (const entry of view.createReadStream({ gt: '/', lt: '/~' })) {
    files.push(entry.value)
  }
  return files
}


// ═════════════════════════════════════════════════════════════════════════════
// STEP F: SHARING WITH A FRIEND
// ═════════════════════════════════════════════════════════════════════════════
//
// To give a friend write access:
//   1. They send you their writer key (myCore.key from their device)
//   2. You add their core to your Autobase
//   3. You write a 'share' operation so ALL devices know about them
//   4. Everyone's Autobase adds the friend's core and sees their writes
//
// friendWriterKeyHex = the hex of their myCore.key

export async function addWriter(friendWriterKeyHex, myPublicKeyHex) {
  // Convert hex back to Buffer
  const writerKey = b4a.from(friendWriterKeyHex, 'hex')

  // Tell Autobase to include this core in the merge
  await base.addWriter(writerKey, { indexer: true })

  // Write a 'share' operation so other devices also add this writer
  const op = {
    type:      OP_SHARE,
    writerKey: friendWriterKeyHex,
    author:    myPublicKeyHex,
    timestamp: Date.now(),
  }
  await base.append(b4a.from(JSON.stringify(op)))

  // Now reconnect to DHT so the friend's core gets replicated
  // Their writes will start appearing in the merged view
}

// On startup, reload any previously granted writers from the view
export async function reloadWriters() {
  for await (const entry of view.createReadStream({ gt: 'writers/', lt: 'writers/~' })) {
    const { writerKey } = entry.value
    const key = b4a.from(writerKey, 'hex')
    // addWriter is idempotent — safe to call again
    await base.addWriter(key, { indexer: true })
  }
}


// ═════════════════════════════════════════════════════════════════════════════
// STEP G: TEARDOWN
// ═════════════════════════════════════════════════════════════════════════════

export async function closeP2P() {
  await swarm?.destroy()
  await store?.close()
}