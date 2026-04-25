/**
 * lib/identityEngine.ts — ShardSafe
 *
 * Place this file at:  lib/identityEngine.ts  (next to your app/ folder)
 *
 * Install dependencies:
 *   npx expo install expo-secure-store
 *   npm install bip39 @noble/ed25519 @noble/hashes react-native-get-random-values
 *
 * In your app/_layout.tsx, make sure this is the VERY FIRST import:
 *   import 'react-native-get-random-values';
 */
 
import * as ed from '@noble/ed25519';
import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha256';
import * as bip39 from 'bip39';
import * as SecureStore from 'expo-secure-store';
 
// ─── Storage keys ─────────────────────────────────────────────────────────────
const STORE_KEY_PRIVATE = 'shardsafe.privateKey';
const STORE_KEY_PUBLIC  = 'shardsafe.publicKey';
 
// ─── Types ────────────────────────────────────────────────────────────────────
export interface Identity {
  privateKey:    Uint8Array; // 32 bytes — never transmitted
  publicKey:     Uint8Array; // 32 bytes — your user ID, safe to share
  encryptionKey: Uint8Array; // 32 bytes — used by cryptoEngine to encrypt files
  discoveryKey:  Uint8Array; // 32 bytes — used as Hyperswarm topic
}
 
// ─── Helpers ──────────────────────────────────────────────────────────────────
function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}
 
function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}
 
// ─── 1. Mnemonic ─────────────────────────────────────────────────────────────
 
/** Generate a fresh 12-word BIP-39 mnemonic. Show to user once, never store. */
export function generateMnemonic(): string {
  return bip39.generateMnemonic(128); // 128 bits = 12 words
}
 
/** Returns true if the string is a valid BIP-39 mnemonic. */
export function validateMnemonic(mnemonic: string): boolean {
  return bip39.validateMnemonic(mnemonic.trim().toLowerCase());
}
 
// ─── 2. Key derivation ────────────────────────────────────────────────────────
 
/**
 * Derive the full Identity from a mnemonic.
 * Same mnemonic always produces the same keys — this is how restore works.
 *
 * mnemonic → seed (PBKDF2, 64 bytes)
 *   seed[0..31] → privateKey (Ed25519)
 *   privateKey  → publicKey  (Ed25519 math)
 *   privateKey  → encryptionKey (HKDF, separate from signing key)
 *   publicKey   → discoveryKey  (SHA-256, safe to announce publicly)
 */
export async function deriveIdentityFromMnemonic(mnemonic: string): Promise<Identity> {
  const normalised = mnemonic.trim().toLowerCase();
 
  if (!bip39.validateMnemonic(normalised)) {
    throw new Error('Invalid mnemonic. Please check your 12 words and try again.');
  }
 
  const seed = bip39.mnemonicToSeedSync(normalised); // Buffer, 64 bytes
  const privateKey = new Uint8Array(seed.slice(0, 32));
  const publicKey  = await ed.getPublicKey(privateKey);
 
  // Derive encryption key via HKDF — different algorithm, never reuse keys
  const encryptionKey = new Uint8Array(
    hkdf(sha256, privateKey, undefined, new TextEncoder().encode('shardsafe-enc-v1'), 32)
  );
 
  // Derive discovery key from public key — safe to announce to DHT
  const prefix = new TextEncoder().encode('shardsafe-discovery');
  const combined = new Uint8Array(prefix.length + publicKey.length);
  combined.set(prefix);
  combined.set(publicKey, prefix.length);
  const discoveryKey = new Uint8Array(sha256(combined));
 
  return { privateKey, publicKey, encryptionKey, discoveryKey };
}
 
// ─── 3. Secure storage ────────────────────────────────────────────────────────
 
/** Save keypair to hardware-backed secure storage. Call after confirming mnemonic. */
export async function saveIdentity(identity: Identity): Promise<void> {
  await SecureStore.setItemAsync(STORE_KEY_PRIVATE, toHex(identity.privateKey));
  await SecureStore.setItemAsync(STORE_KEY_PUBLIC,  toHex(identity.publicKey));
}
 
/**
 * Load the identity from secure storage.
 * Returns null if no identity exists (first launch → show onboarding).
 */
export async function loadIdentity(): Promise<Identity | null> {
  const privateHex = await SecureStore.getItemAsync(STORE_KEY_PRIVATE);
  const publicHex  = await SecureStore.getItemAsync(STORE_KEY_PUBLIC);
 
  if (!privateHex || !publicHex) return null;
 
  const privateKey = fromHex(privateHex);
  const publicKey  = fromHex(publicHex);
 
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
 
/** Returns true if a keypair is already stored on this device. */
export async function hasIdentity(): Promise<boolean> {
  const key = await SecureStore.getItemAsync(STORE_KEY_PRIVATE);
  return key !== null;
}
 
/** Wipe the stored identity (logout / reset). User needs mnemonic to restore. */
export async function clearIdentity(): Promise<void> {
  await SecureStore.deleteItemAsync(STORE_KEY_PRIVATE);
  await SecureStore.deleteItemAsync(STORE_KEY_PUBLIC);
}
 
// ─── 4. Signing ───────────────────────────────────────────────────────────────
 
/** Sign data with private key. Use for Hypercore entries. */
export async function sign(data: Uint8Array, privateKey: Uint8Array): Promise<Uint8Array> {
  return ed.sign(data, privateKey);
}
 
/** Verify a signature. Returns true if valid. */
export async function verify(
  signature: Uint8Array,
  data: Uint8Array,
  publicKey: Uint8Array,
): Promise<boolean> {
  return ed.verify(signature, data, publicKey);
}
 
// ─── 5. Display helpers ───────────────────────────────────────────────────────
 
/** Short display version of public key: "9d4e2f...1c3b" */
export function shortPublicKey(publicKey: Uint8Array): string {
  const hex = toHex(publicKey);
  return `${hex.slice(0, 6)}...${hex.slice(-4)}`;
}
 
/** Hex-encode public key for sharing with another peer. */
export function exportPublicKey(publicKey: Uint8Array): string {
  return toHex(publicKey);
}