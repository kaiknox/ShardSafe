/**
 * lib/identityEngine.ts — ShardSafe
 *
 * Place at: lib/identityEngine.ts
 *
 * Install:
 *   npx expo install expo-secure-store
 *   npm install bip39 @noble/ed25519 @noble/hashes react-native-get-random-values
 *
 * The VERY FIRST line of app/_layout.tsx must be:
 *   import 'react-native-get-random-values';
 */

import * as ed from '@noble/ed25519';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import * as bip39 from 'bip39';
import * as SecureStore from 'expo-secure-store';

// ─── Storage keys ─────────────────────────────────────────────────────────────
const STORE_KEY_PRIVATE = 'shardsafe.privateKey';
const STORE_KEY_PUBLIC  = 'shardsafe.publicKey';

// ─── Types ────────────────────────────────────────────────────────────────────
export interface Identity {
  privateKey:    Uint8Array; // 32 bytes — never transmitted, stored in secure enclave
  publicKey:     Uint8Array; // 32 bytes — your user ID, safe to share
  encryptionKey: Uint8Array; // 32 bytes — for file encryption (derived, not stored)
  discoveryKey:  Uint8Array; // 32 bytes — Hyperswarm DHT topic (derived, not stored)
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export function fromHex(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error('Invalid hex string length');
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

// ─── 1. Mnemonic ──────────────────────────────────────────────────────────────

/** Generate a fresh 12-word BIP-39 mnemonic. Show to user ONCE, never store. */
export function generateMnemonic(): string {
  return bip39.generateMnemonic(128); // 128 bits entropy = 12 words
}

/** Returns true if the string is a valid BIP-39 mnemonic. */
export function validateMnemonic(mnemonic: string): boolean {
  return bip39.validateMnemonic(mnemonic.trim().toLowerCase());
}

// ─── 2. Key derivation ────────────────────────────────────────────────────────

/**
 * Derive the full Identity from a mnemonic.
 * Deterministic — same mnemonic ALWAYS produces same keys on any device.
 *
 * Derivation chain:
 *   mnemonic
 *     → seed          (PBKDF2 via bip39, 64 bytes)
 *     → privateKey    (seed[0..31], Ed25519 signing key)
 *     → publicKey     (Ed25519 point multiplication — one-way math)
 *     → encryptionKey (HKDF from privateKey — separate key, never reuse)
 *     → discoveryKey  (SHA-256 of "shardsafe-discovery" + publicKey)
 */
export async function deriveIdentityFromMnemonic(mnemonic: string): Promise<Identity> {
  const normalised = mnemonic.trim().toLowerCase();

  if (!bip39.validateMnemonic(normalised)) {
    throw new Error('Invalid mnemonic. Please check your 12 words and try again.');
  }

  // PBKDF2 — slow by design (makes brute force hard), 64 bytes output
  const seed = bip39.mnemonicToSeedSync(normalised);
  const privateKey = new Uint8Array(seed.slice(0, 32));

  // Ed25519 public key — mathematically derived, cannot reverse to get privateKey
  const publicKey = await ed.getPublicKey(privateKey);

  // FIX: use a dedicated label so encryptionKey ≠ privateKey and ≠ any other derived key
  // HKDF is designed exactly for this — deriving multiple independent keys from one secret
  const encryptionKey = new Uint8Array(
    hkdf(sha256, privateKey, undefined, new TextEncoder().encode('shardsafe-enc-v1'), 32)
  );

  // Discovery key is derived from PUBLIC key (safe to announce)
  // never derive the discovery key from the private key directly
  const prefix = new TextEncoder().encode('shardsafe-discovery');
  const combined = new Uint8Array(prefix.length + publicKey.length);
  combined.set(prefix);
  combined.set(publicKey, prefix.length);
  const discoveryKey = new Uint8Array(sha256(combined));

  return { privateKey, publicKey, encryptionKey, discoveryKey };
}

// ─── 3. Secure storage ────────────────────────────────────────────────────────

/**
 * Save keypair to hardware-backed secure storage.
 * iOS:     Keychain (hardware Secure Enclave on modern devices)
 * Android: Keystore (hardware-backed on most devices since Android 6)
 *
 * We only store privateKey + publicKey.
 * encryptionKey and discoveryKey are always re-derived on load — no extra attack surface.
 */
export async function saveIdentity(identity: Identity): Promise<void> {
  await SecureStore.setItemAsync(STORE_KEY_PRIVATE, toHex(identity.privateKey));
  await SecureStore.setItemAsync(STORE_KEY_PUBLIC,  toHex(identity.publicKey));
}

/**
 * Load keypair from secure storage and re-derive the full identity.
 * Returns null on first launch (no identity stored yet → show onboarding).
 */
export async function loadIdentity(): Promise<Identity | null> {
  const privateHex = await SecureStore.getItemAsync(STORE_KEY_PRIVATE);
  const publicHex  = await SecureStore.getItemAsync(STORE_KEY_PUBLIC);

  if (!privateHex || !publicHex) return null;

  const privateKey = fromHex(privateHex);
  const publicKey  = fromHex(publicHex);

  // Re-derive — deterministic, no need to store these
  const encryptionKey = new Uint8Array(
    hkdf(sha256, privateKey, undefined, new TextEncoder().encode('shardsafe-enc-v1'), 32)
  );

  const prefix = new TextEncoder().encode('shardsafe-discovery');
  const combined = new Uint8Array(prefix.length + publicKey.length);
  combined.set(prefix);
  combined.set(publicKey, prefix.length);
  const discoveryKey = new Uint8Array(sha256(combined));

  return { privateKey, publicKey, encryptionKey, discoveryKey };
}

/** True if a keypair exists on this device. Use at startup to gate onboarding. */
export async function hasIdentity(): Promise<boolean> {
  const key = await SecureStore.getItemAsync(STORE_KEY_PRIVATE);
  return key !== null;
}

/** Delete stored identity. User needs mnemonic to restore. */
export async function clearIdentity(): Promise<void> {
  await SecureStore.deleteItemAsync(STORE_KEY_PRIVATE);
  await SecureStore.deleteItemAsync(STORE_KEY_PUBLIC);
}

// ─── 4. Signing ───────────────────────────────────────────────────────────────

/**
 * Sign arbitrary bytes with your private key.
 * Returns a 64-byte Ed25519 signature.
 * Use this when writing Hypercore entries so peers can verify authorship.
 */
export async function sign(data: Uint8Array, privateKey: Uint8Array): Promise<Uint8Array> {
  return ed.sign(data, privateKey);
}

/**
 * Verify a signature against a public key.
 * Returns true only if the signature was produced by the holder of privateKey.
 */
export async function verify(
  signature: Uint8Array,
  data: Uint8Array,
  publicKey: Uint8Array,
): Promise<boolean> {
  return ed.verify(signature, data, publicKey);
}

// ─── 5. Display / sharing helpers ─────────────────────────────────────────────

/** Shortened public key for UI display: "9d4e2f...1c3b" */
export function shortPublicKey(publicKey: Uint8Array): string {
  const hex = toHex(publicKey);
  return `${hex.slice(0, 6)}...${hex.slice(-4)}`;
}

/** Full hex public key for sharing with a peer ("Add me as a writer"). */
export function exportPublicKey(publicKey: Uint8Array): string {
  return toHex(publicKey);
}

/** Parse a hex public key string back to bytes. */
export function importPublicKey(hex: string): Uint8Array {
  if (hex.length !== 64) throw new Error('Invalid public key — expected 64 hex characters.');
  return fromHex(hex);
}
