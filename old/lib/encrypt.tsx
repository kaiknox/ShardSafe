/**
 * encrypt.tsx — ShardSafe v4.1 (Versió corregida per a proves)
 * * Canvis:
 * - Límit de 15 dispositius (realista per a P2P mòbil).
 * - El botó + funciona lliurement fins a 15.
 * - Suport per a "dispositius fantasma" si n > llista de contactes.
 */

import { encryptAndShard } from '@/lib/cryptoEngine';
import type { Device } from '@/lib/deviceRegistry';
import { DEFAULT_DEVICES, majorityThreshold } from '@/lib/deviceRegistry';
import type { ShardPackage } from '@/lib/shardPackage';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import React, { useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';

// ─── Constants de configuració ──────────────────────────────────────────────
const MAX_DEVICES = 15; // Límit de seguretat per a rendiment P2P

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateFileId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function readAsBase64(asset: DocumentPicker.DocumentPickerAsset): Promise<string> {
  if (Platform.OS === 'web') {
    const file = (asset as any).file as File | undefined;
    if (file) return blobToBase64(file);
    const blob = await (await fetch(asset.uri)).blob();
    return blobToBase64(blob);
  }
  return FileSystem.readAsStringAsync(asset.uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = () => reject(new Error('Error llegint el fitxer'));
    reader.readAsDataURL(blob);
  });
}

async function exportPackageFile(pkg: ShardPackage, device: Device): Promise<void> {
  const content  = JSON.stringify(pkg, null, 2);
  const fileName = `${pkg.originalName}_pkg${pkg.shardIndex}.shardsafe.json`;

  if (Platform.OS === 'web') {
    const blob = new Blob([content], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
    return;
  }
  const path = `${FileSystem.cacheDirectory}${fileName}`;
  await FileSystem.writeAsStringAsync(path, content, {
    encoding: FileSystem.EncodingType.UTF8,
  });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(path, { mimeType: 'application/json' });
  } else {
    Alert.alert('Paquet exportat', `Desa-ho i envia-ho a ${device.name}`);
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

type PackageEntry = {
  device: Device;
  pkg: ShardPackage;
  exported: boolean;
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function EncryptScreen() {
  const devices = DEFAULT_DEVICES;

  const [selectedFile, setSelectedFile] = useState<{
    name: string;
    asset: DocumentPicker.DocumentPickerAsset;
  } | null>(null);

  // Estat del comptador (n) i llindar (k)
  const [totalShards, setTotalShards] = useState(3); 
  const threshold = majorityThreshold(totalShards);

  const [loading, setLoading]   = useState(false);
  const [packages, setPackages] = useState<PackageEntry[] | null>(null);

  const handlePickFile = async () => {
    try {
      const picked = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
      if (picked.canceled || !picked.assets?.length) return;
      setSelectedFile({ name: picked.assets[0].name, asset: picked.assets[0] });
      setPackages(null);
    } catch {
      Alert.alert('Error', "No s'ha pogut seleccionar el fitxer.");
    }
  };

  const handleEncrypt = async () => {
    if (!selectedFile) return;
    setLoading(true);
    try {
      const base64    = await readAsBase64(selectedFile.asset);
      const result    = await encryptAndShard(base64, totalShards, threshold);
      const fileId    = generateFileId();
      const createdAt = new Date().toISOString();

      const entries: PackageEntry[] = result.shards.map((shard, i) => {
        const pkg: ShardPackage = {
          version: 2,
          fileId,
          originalName: selectedFile.name,
          shardIndex: i + 1,
          totalShards,
          threshold,
          shard,
          encryptedPayload: result.encryptedPayload,
          metadata: { algorithm: 'AES-256-GCM + SSS-GF256', createdAt },
        };

        // Si no hi ha prou dispositius reals a la llista, creem un placeholder
        const safeDevice = devices[i] || { 
          id: `extra-${i}`, 
          name: `Dispositiu Extra ${i + 1}`, 
          address: 'P2P-Pendent' 
        };

        return { device: safeDevice, pkg, exported: false };
      });

      setPackages(entries);
    } catch (e: any) {
      Alert.alert('Error al xifrar', e.message ?? 'Error desconegut.');
    } finally {
      setLoading(false);
    }
  };

  const handleExport = async (idx: number) => {
    if (!packages) return;
    const entry = packages[idx];
    try {
      await exportPackageFile(entry.pkg, entry.device);
      setPackages(prev =>
        prev!.map((e, i) => (i === idx ? { ...e, exported: true } : e))
      );
    } catch (e: any) {
      Alert.alert('Error en exportar', e.message);
    }
  };

  const allExported = packages?.every(e => e.exported) ?? false;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>

      <View style={styles.header}>
        <Text style={styles.headerTitle}>Xifrar</Text>
        <Text style={styles.headerSub}>Distribueix la clau entre dispositius</Text>
      </View>

      {/* ── 01 Fitxer ─────────────────────────────────────────────────────── */}
      <View style={styles.section}>
        <Text style={styles.stepLabel}>01 — Fitxer a protegir</Text>
        <TouchableOpacity style={styles.fileButton} onPress={handlePickFile}>
          <Text style={styles.fileIcon}>📎</Text>
          <Text style={styles.fileText} numberOfLines={1}>
            {selectedFile ? selectedFile.name : 'Selecciona un fitxer...'}
          </Text>
          {selectedFile && <Text style={styles.fileChange}>Canviar</Text>}
        </TouchableOpacity>
      </View>

      {/* ── 02 Fragments ──────────────────────────────────────────────────── */}
      {!packages && (
        <View style={styles.section}>
          <Text style={styles.stepLabel}>02 — Fragments i llindar</Text>

          <View style={styles.shardRow}>
            <View style={styles.stepperBlock}>
              <Text style={styles.stepperLabel}>Dispositius (n)</Text>
              <View style={styles.stepper}>
                <TouchableOpacity
                  style={styles.stepBtn}
                  onPress={() => setTotalShards(s => Math.max(2, s - 1))}
                >
                  <Text style={styles.stepBtnText}>−</Text>
                </TouchableOpacity>
                <Text style={styles.stepValue}>{totalShards}</Text>
                <TouchableOpacity
                  style={styles.stepBtn}
                  onPress={() => setTotalShards(s => Math.min(MAX_DEVICES, s + 1))}
                >
                  <Text style={styles.stepBtnText}>+</Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={[styles.stepperBlock, styles.kBlock]}>
              <Text style={styles.stepperLabel}>Mínim per obrir (k)</Text>
              <View style={styles.kValueRow}>
                <Text style={styles.kValue}>{threshold}</Text>
                <Text style={styles.kAuto}>automàtic</Text>
              </View>
            </View>
          </View>

          <TouchableOpacity
            style={[styles.primaryBtn, (!selectedFile || loading) && styles.btnDisabled]}
            onPress={handleEncrypt}
            disabled={!selectedFile || loading}
          >
            {loading
              ? <ActivityIndicator color="#0a0a0a" />
              : <Text style={styles.primaryBtnText}>Xifrar i generar paquets</Text>
            }
          </TouchableOpacity>
        </View>
      )}

      {/* ── 03 Llista de paquets ─────────────────────────────────────────── */}
      {packages && (
        <View style={styles.section}>
          <Text style={styles.stepLabel}>03 — Distribuir paquets</Text>
          {packages.map((entry, idx) => (
            <View key={entry.device.id} style={[styles.packageRow, entry.exported && styles.packageRowDone]}>
              <View style={styles.packageLeft}>
                <Text style={styles.packageDevice}>{entry.device.name}</Text>
                <Text style={styles.packageMeta}>Fragment {entry.pkg.shardIndex}/{entry.pkg.totalShards}</Text>
              </View>
              <TouchableOpacity
                style={[styles.exportBtn, entry.exported && styles.exportBtnDone]}
                onPress={() => handleExport(idx)}
              >
                <Text style={styles.exportBtnText}>{entry.exported ? '✓' : 'Exportar'}</Text>
              </TouchableOpacity>
            </View>
          ))}
          
          <TouchableOpacity style={styles.resetBtn} onPress={() => {setPackages(null); setSelectedFile(null);}}>
            <Text style={styles.resetBtnText}>↺ Torna a començar</Text>
          </TouchableOpacity>
        </View>
      )}

    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  content: { padding: 24, paddingBottom: 60 },
  header: { marginBottom: 36, marginTop: Platform.OS === 'ios' ? 20 : 8 },
  headerTitle: { fontSize: 32, fontWeight: '800', color: '#f0f0f0' },
  headerSub: { fontSize: 13, color: '#555', letterSpacing: 2, textTransform: 'uppercase' },
  section: { marginBottom: 32 },
  stepLabel: { fontSize: 11, fontWeight: '700', color: '#4ECDC4', letterSpacing: 3, textTransform: 'uppercase', marginBottom: 12 },
  fileButton: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#161616', borderWidth: 1, borderColor: '#2a2a2a', borderRadius: 12, padding: 16, gap: 12 },
  fileIcon: { fontSize: 20 },
  fileText: { color: '#c0c0c0', fontSize: 14, flex: 1 },
  fileChange: { color: '#4ECDC4', fontSize: 12, fontWeight: '600' },
  shardRow: { flexDirection: 'row', gap: 12, marginBottom: 14 },
  stepperBlock: { flex: 1, backgroundColor: '#161616', borderWidth: 1, borderColor: '#2a2a2a', borderRadius: 12, padding: 16, alignItems: 'center', gap: 10 },
  kBlock: { borderColor: '#1e3a3a', backgroundColor: '#0d1a1a' },
  stepperLabel: { fontSize: 11, color: '#666' },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  stepBtn: { width: 32, height: 32, borderRadius: 8, backgroundColor: '#222', alignItems: 'center', justifyContent: 'center' },
  stepBtnText: { color: '#f0f0f0', fontSize: 18 },
  stepValue: { color: '#f0f0f0', fontSize: 28, fontWeight: '700', minWidth: 32, textAlign: 'center' },
  kValueRow: { alignItems: 'center' },
  kValue: { color: '#4ECDC4', fontSize: 28, fontWeight: '700' },
  kAuto: { color: '#3a7a74', fontSize: 10, textTransform: 'uppercase' },
  primaryBtn: { backgroundColor: '#4ECDC4', borderRadius: 12, padding: 18, alignItems: 'center' },
  btnDisabled: { opacity: 0.35 },
  primaryBtnText: { color: '#0a0a0a', fontSize: 15, fontWeight: '800' },
  packageRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#111', borderWidth: 1, borderColor: '#1e1e1e', borderRadius: 12, padding: 14, marginBottom: 10, gap: 12 },
  packageRowDone: { opacity: 0.5 },
  packageLeft: { flex: 1 },
  packageDevice: { color: '#e0e0e0', fontWeight: '700', fontSize: 14 },
  packageMeta: { color: '#3a7a74', fontSize: 11 },
  exportBtn: { backgroundColor: '#4ECDC4', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 10 },
  exportBtnDone: { backgroundColor: '#1a3a3a' },
  exportBtnText: { color: '#0a0a0a', fontSize: 12, fontWeight: '800' },
  resetBtn: { alignItems: 'center', padding: 16 },
  resetBtnText: { color: '#444', fontSize: 13 },
});