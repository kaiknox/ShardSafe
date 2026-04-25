/**
 * cryptoEngine.js — ShardSafe
 *
 * Hybrid encryption module for React Native / Expo.
 * Strategy:
 *   1. Generate a random 256-bit AES Master Key.
 *   2. Encrypt the file with AES-256-GCM (via crypto-js).
 *   3. Split only the Master Key into n shards using Shamir's Secret Sharing (secrets.js-grempe).
 *
 * Install dependencies:
 *   npx expo install crypto-js secrets.js-grempe
 *   npx expo install react-native-get-random-values   ← polyfill for crypto.getRandomValues
 *
 * Usage: import this file AFTER the polyfill import in your entry point:
 *   import 'react-native-get-random-values';   // must be first
 *   import { encryptAndShard, reconstructAndDecrypt } from '@/lib/cryptoEngine';
 */

import 'react-native-get-random-values'; // polyfill – safe to import multiple times
import CryptoJS from 'crypto-js';
import * as secrets from 'secrets.js-grempe';

// ─────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────

/**
 * Generate a cryptographically secure random hex string of `byteLength` bytes.
 * Uses the polyfilled crypto.getRandomValues so it works in Expo / Hermes.
 */
function randomHex(byteLength = 32) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Convert a hex string to a CryptoJS WordArray (needed by crypto-js).
 */
function hexToWordArray(hex) {
  return CryptoJS.enc.Hex.parse(hex);
}

/**
 * Convert a CryptoJS WordArray to a hex string.
 */
function wordArrayToHex(wordArray) {
  return CryptoJS.enc.Hex.stringify(wordArray);
}

// ─────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────

/**
 * encryptAndShard
 *
 * Encrypts a file and splits the encryption key into shards.
 *
 * @param {string} fileData      - File contents encoded as a Base64 string.
 * @param {number} totalShards   - Total number of shards to generate (n).
 * @param {number} threshold     - Minimum shards required to reconstruct (k). Must be <= totalShards.
 *
 * @returns {{
 *   encryptedPayload: {
 *     ciphertext: string,   // Base64-encoded AES-256-GCM ciphertext
 *     iv: string,           // Hex-encoded 12-byte IV (GCM nonce)
 *     tag: string,          // Hex-encoded 16-byte GCM authentication tag
 *   },
 *   shards: string[],       // Array of hex-encoded SSS shards (length = totalShards)
 *   metadata: {
 *     totalShards: number,
 *     threshold: number,
 *     algorithm: string,
 *   }
 * }}
 */
export function encryptAndShard(fileData, totalShards, threshold) {
  // ── Validation ──────────────────────────────
  if (typeof fileData !== 'string' || fileData.length === 0) {
    throw new Error('fileData must be a non-empty Base64 string.');
  }
  if (!Number.isInteger(totalShards) || totalShards < 2) {
    throw new Error('totalShards must be an integer >= 2.');
  }
  if (!Number.isInteger(threshold) || threshold < 2) {
    throw new Error('threshold must be an integer >= 2.');
  }
  if (threshold > totalShards) {
    throw new Error('threshold cannot be greater than totalShards.');
  }

  // ── Step 1: Generate Master Key + IV ─────────
  const masterKeyHex = randomHex(32); // 256-bit key
  const ivHex = randomHex(12);        // 96-bit nonce (recommended for GCM)

  // ── Step 2: AES-256-GCM encryption ───────────
  const keyWordArray = hexToWordArray(masterKeyHex);
  const ivWordArray = hexToWordArray(ivHex);

  // crypto-js expects the plaintext as a WordArray or string.
  // Our fileData is Base64 — parse it so it's treated as raw bytes, not text.
  const plaintext = CryptoJS.enc.Base64.parse(fileData);

  const encrypted = CryptoJS.AES.encrypt(plaintext, keyWordArray, {
    iv: ivWordArray,
    mode: CryptoJS.mode.GCM,
    padding: CryptoJS.pad.NoPadding,
  });

  // GCM produces a separate authentication tag
  const ciphertextBase64 = encrypted.ciphertext.toString(CryptoJS.enc.Base64);
  const tagHex = wordArrayToHex(encrypted.tag); // 16-byte (128-bit) auth tag

  // ── Step 3: Shard the Master Key via SSS ─────
  // secrets.js-grempe works with hex strings natively
  const shards = secrets.share(masterKeyHex, totalShards, threshold);

  // ── Result ────────────────────────────────────
  return {
    encryptedPayload: {
      ciphertext: ciphertextBase64,
      iv: ivHex,
      tag: tagHex,
    },
    shards,
    metadata: {
      totalShards,
      threshold,
      algorithm: 'AES-256-GCM + SSS',
    },
  };
}

/**
 * reconstructAndDecrypt
 *
 * Reconstructs the Master Key from shards and decrypts the file.
 *
 * @param {{
 *   ciphertext: string,  // Base64-encoded ciphertext
 *   iv: string,          // Hex IV
 *   tag: string,         // Hex GCM auth tag
 * }} encryptedPayload
 *
 * @param {string[]} shards - Array of SSS shard strings (at least `threshold` of them).
 *
 * @returns {string} The original file contents as a Base64 string.
 *
 * @throws {Error} If fewer than threshold shards are provided, or if the
 *                 authentication tag doesn't match (tampered data).
 */
export function reconstructAndDecrypt(encryptedPayload, shards) {
  // ── Validation ──────────────────────────────
  if (!encryptedPayload || !encryptedPayload.ciphertext || !encryptedPayload.iv || !encryptedPayload.tag) {
    throw new Error('encryptedPayload must contain ciphertext, iv, and tag.');
  }
  if (!Array.isArray(shards) || shards.length < 2) {
    throw new Error('shards must be an array with at least 2 elements.');
  }

  const { ciphertext, iv, tag } = encryptedPayload;

  // ── Step 1: Reconstruct Master Key via SSS ───
  // secrets.js-grempe will throw if there aren't enough valid shards
  let masterKeyHex;
  try {
    masterKeyHex = secrets.combine(shards);
  } catch (err) {
    throw new Error(`SSS reconstruction failed: ${err.message}`);
  }

  if (!masterKeyHex || masterKeyHex === '0'.repeat(masterKeyHex.length)) {
    throw new Error('Reconstructed key is invalid. Check that your shards belong to the same secret.');
  }

  // ── Step 2: AES-256-GCM decryption ───────────
  const keyWordArray = hexToWordArray(masterKeyHex);
  const ivWordArray = hexToWordArray(iv);
  const tagWordArray = hexToWordArray(tag);
  const ciphertextWordArray = CryptoJS.enc.Base64.parse(ciphertext);

  // CryptoJS.lib.CipherParams bundles ciphertext + tag for GCM
  const cipherParams = CryptoJS.lib.CipherParams.create({
    ciphertext: ciphertextWordArray,
    tag: tagWordArray,
  });

  let decrypted;
  try {
    decrypted = CryptoJS.AES.decrypt(cipherParams, keyWordArray, {
      iv: ivWordArray,
      mode: CryptoJS.mode.GCM,
      padding: CryptoJS.pad.NoPadding,
    });
  } catch (err) {
    throw new Error(
      'Decryption failed. The data may be corrupted or the authentication tag is invalid.'
    );
  }

  // Convert the decrypted WordArray back to Base64
  const originalBase64 = decrypted.toString(CryptoJS.enc.Base64);

  if (!originalBase64) {
    throw new Error('Decryption produced empty output. Verify your shards and encrypted payload.');
  }

  return originalBase64;
}
