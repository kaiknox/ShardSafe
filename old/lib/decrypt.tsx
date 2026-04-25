/**
 * decrypt.tsx — ShardSafe v4
 *
 * Flux receptor:
 *   1. Prems "Comprovar fragments" → el dispositiu consulta la taula de hash
 *      local per veure quins _pkgN.shardsafe.json ha rebut de cada peer
 *   2. Els agrupa per fileId — cada grup és una sessió d'encriptació diferent
 *   3. Si alguna sessió té ≥ k paquets, es desxifra automàticament
 *   4. Es mostra el resultat i es pot desar el fitxer recuperat
 *
 * "Consultar la taula de hash" en aquesta implementació significa:
 *   llegir els fitxers _pkg*.shardsafe.json que els peers han dipositat
 *   a la carpeta de documents del dispositiu (o que l'usuari ha rebut
 *   per qualsevol canal de transport — AirDrop, email, etc.).
 *
 * La funció fetchPackagesFromHashTable() és el punt d'integració:
 *   substituïu-la per una crida HTTP/mDNS/BLE real quan tingueu el transport.
 */

import { reconstructAndDecrypt } from '@/lib/cryptoEngine';
import { DEFAULT_DEVICES } from '@/lib/deviceRegistry';
import type { ShardPackage } from '@/lib/shardPackage';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import React, { useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Image,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';

// ─── Types ────────────────────────────────────────────────────────────────────

type Session = {
  fileId: string;
  originalName: string;
  threshold: number;
  totalShards: number;
  packages: ShardPackage[];
};

type DecryptedContent =
  | { type: 'text';   content: string }
  | { type: 'image';  dataUri: string }
  | { type: 'binary'; base64: string; size: number };

type CheckStatus = 'idle' | 'checking' | 'done';

// ─── Hash table fetch ─────────────────────────────────────────────────────────
//
// PUNT D'INTEGRACIÓ: aquí és on va la lògica de xarxa real.
//
// Ara mateix fa servir DocumentPicker perquè no tenim transport P2P implementat.
// Quan tingueu mDNS / HTTP / BLE, substituïu aquesta funció per:
//   - fer GET a cada device.address de DEFAULT_DEVICES
//   - recollir els ShardPackages que cadascun retorni per a "aquest dispositiu"
//
// La signatura ha de retornar Promise<ShardPackage[]>.

let _cachedPackages: ShardPackage[] = [];

async function fetchPackagesFromHashTable(): Promise<ShardPackage[]> {
  // Simulació: permet seleccionar fitxers manualment (com si els peers els haguessin enviat)
  const picked = await DocumentPicker.getDocumentAsync({
    copyToCacheDirectory: true,
    multiple: true,
  });

  if (picked.canceled || !picked.assets?.length) return _cachedPackages;

  const newPkgs: ShardPackage[] = [];
  const errors: string[] = [];

  for (const asset of picked.assets) {
    try {
      let text: string;
      if (Platform.OS === 'web') {
        const file = (asset as any).file as File | undefined;
        if (file) {
          text = await new Promise<string>((res, rej) => {
            const r = new FileReader();
            r.onload  = () => res(r.result as string);
            r.onerror = () => rej(new Error('Error llegint'));
            r.readAsText(file);
          });
        } else {
          text = await (await fetch(asset.uri)).text();
        }
      } else {
        text = await FileSystem.readAsStringAsync(asset.uri, {
          encoding: FileSystem.EncodingType.UTF8,
        });
      }

      const parsed = JSON.parse(text) as ShardPackage;
      if (
        parsed.version === 2 &&
        parsed.fileId &&
        parsed.shard &&
        parsed.encryptedPayload?.ciphertext &&
        parsed.encryptedPayload?.iv
      ) {
        newPkgs.push(parsed);
      } else {
        errors.push(`${asset.name}: format no vàlid`);
      }
    } catch {
      errors.push(`${asset.name}: no és un JSON vàlid`);
    }
  }

  if (errors.length > 0) {
    Alert.alert('Alguns fitxers ignorats', errors.join('\n'));
  }

  // Fusionar amb cache evitant duplicats
  for (const pkg of newPkgs) {
    const dup = _cachedPackages.some(
      p => p.fileId === pkg.fileId && p.shardIndex === pkg.shardIndex
    );
    if (!dup) _cachedPackages.push(pkg);
  }

  return [..._cachedPackages];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function groupIntoSessions(pkgs: ShardPackage[]): Session[] {
  const map = new Map<string, Session>();
  for (const pkg of pkgs) {
    if (!map.has(pkg.fileId)) {
      map.set(pkg.fileId, {
        fileId:       pkg.fileId,
        originalName: pkg.originalName,
        threshold:    pkg.threshold,
        totalShards:  pkg.totalShards,
        packages:     [],
      });
    }
    const s = map.get(pkg.fileId)!;
    if (!s.packages.some(p => p.shardIndex === pkg.shardIndex)) {
      s.packages.push(pkg);
    }
  }
  return Array.from(map.values());
}

async function saveRestoredFile(base64: string, fileName: string): Promise<void> {
  if (Platform.OS === 'web') {
    const byteChars = atob(base64);
    const bytes = new Uint8Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) bytes[i] = byteChars.charCodeAt(i);
    const blob = new Blob([bytes]);
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = fileName; a.click();
    URL.revokeObjectURL(url);
    return;
  }
  const path = `${FileSystem.cacheDirectory}${fileName}`;
  await FileSystem.writeAsStringAsync(path, base64, {
    encoding: FileSystem.EncodingType.Base64,
  });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(path);
  } else {
    Alert.alert('Desat', `Fitxer guardat a:\n${path}`);
  }
}

function decodeContent(base64: string, fileName: string): DecryptedContent {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  const textExts = ['txt', 'md', 'json', 'csv', 'xml', 'html', 'js', 'ts', 'py', 'log', 'yaml', 'yml'];
  const imgExts  = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'];
  const mimeMap: Record<string, string> = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
    gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp',
  };
  if (textExts.includes(ext)) {
    try {
      const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
      return { type: 'text', content: new TextDecoder('utf-8').decode(bytes) };
    } catch {
      return { type: 'text', content: atob(base64) };
    }
  }
  if (imgExts.includes(ext)) {
    return { type: 'image', dataUri: `data:${mimeMap[ext] ?? 'image/png'};base64,${base64}` };
  }
  return { type: 'binary', base64, size: Math.floor(base64.length * 0.75) };
}

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(2)} MB`;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function DecryptScreen() {
  const [checkStatus, setCheckStatus]   = useState<CheckStatus>('idle');
  const [sessions, setSessions]         = useState<Session[]>([]);
  const [decryptingId, setDecryptingId] = useState<string | null>(null);
  const [results, setResults]           = useState<Map<string, DecryptedContent>>(new Map());

  // ── Comprovar fragments ───────────────────────────────────────────────────
  //
  // 1. Consulta la taula de hash (fetchPackagesFromHashTable)
  // 2. Agrupa per fileId
  // 3. Per a cada sessió amb ≥ k fragments → desxifra automàticament
  //
  const handleCheck = async () => {
    setCheckStatus('checking');
    try {
      const pkgs     = await fetchPackagesFromHashTable();
      const grouped  = groupIntoSessions(pkgs);
      setSessions(grouped);

      // Auto-desxifrar les sessions que ja tenen prou fragments
      for (const session of grouped) {
        const alreadyDecrypted = results.has(session.fileId);
        if (!alreadyDecrypted && session.packages.length >= session.threshold) {
          await decryptSession(session);
        }
      }
    } catch (e: any) {
      Alert.alert('Error en comprovar', e.message ?? 'Error desconegut.');
    } finally {
      setCheckStatus('done');
    }
  };

  // ── Desxifrar una sessió (intern) ─────────────────────────────────────────
  const decryptSession = async (session: Session) => {
    setDecryptingId(session.fileId);
    try {
      const shardsToUse = session.packages
        .slice(0, session.threshold)
        .map(p => p.shard);

      const encryptedPayload = session.packages[0].encryptedPayload;
      const decryptedBase64  = await reconstructAndDecrypt(encryptedPayload, shardsToUse);
      const content          = decodeContent(decryptedBase64, session.originalName);

      setResults(prev => new Map(prev).set(session.fileId, content));
    } catch (e: any) {
      Alert.alert(
        `Error al desxifrar ${session.originalName}`,
        e.message ?? 'Comprova que els paquets pertanyin al mateix fitxer.'
      );
    } finally {
      setDecryptingId(null);
    }
  };

  // ── Desar fitxer recuperat ────────────────────────────────────────────────
  const handleDownload = async (session: Session) => {
    const content = results.get(session.fileId);
    if (!content) return;
    const base64 =
      content.type === 'binary' ? content.base64 :
      content.type === 'text'   ? btoa(unescape(encodeURIComponent(content.content))) :
      content.dataUri.split(',')[1];
    try {
      await saveRestoredFile(base64, session.originalName);
    } catch (e: any) {
      Alert.alert('Error en desar', e.message);
    }
  };

  const totalFragments = sessions.reduce((acc, s) => acc + s.packages.length, 0);
  const readySessions  = sessions.filter(s => s.packages.length >= s.threshold);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>

      <View style={styles.header}>
        <Text style={styles.headerTitle}>Recuperar</Text>
        <Text style={styles.headerSub}>Desxifra amb els fragments rebuts</Text>
      </View>

      {/* ── Peers de la taula de hash ──────────────────────────────────────── */}
      <View style={styles.section}>
        <Text style={styles.stepLabel}>Xarxa de confiança</Text>
        <View style={styles.peersRow}>
          {DEFAULT_DEVICES.map(dev => (
            <View key={dev.id} style={styles.peerPill}>
              <View style={styles.peerDot} />
              <Text style={styles.peerName} numberOfLines={1}>{dev.name}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* ── Botó principal ────────────────────────────────────────────────── */}
      <View style={styles.section}>
        <TouchableOpacity
          style={[styles.checkBtn, checkStatus === 'checking' && styles.checkBtnChecking]}
          onPress={handleCheck}
          disabled={checkStatus === 'checking'}
          activeOpacity={0.8}
        >
          {checkStatus === 'checking' ? (
            <View style={styles.checkBtnInner}>
              <ActivityIndicator color="#4ECDC4" style={{ marginRight: 10 }} />
              <Text style={styles.checkBtnText}>Comprovant fragments...</Text>
            </View>
          ) : (
            <View style={styles.checkBtnInner}>
              <Text style={styles.checkBtnIcon}>🔍</Text>
              <View>
                <Text style={styles.checkBtnText}>Comprovar fragments</Text>
                <Text style={styles.checkBtnSub}>
                  Consulta els {DEFAULT_DEVICES.length} dispositius de la taula de hash
                </Text>
              </View>
            </View>
          )}
        </TouchableOpacity>

        {/* Resum ràpid post-check */}
        {checkStatus === 'done' && (
          <View style={styles.summaryRow}>
            <View style={styles.summaryPill}>
              <Text style={styles.summaryNum}>{totalFragments}</Text>
              <Text style={styles.summaryLabel}>fragments trobats</Text>
            </View>
            <View style={styles.summaryPill}>
              <Text style={styles.summaryNum}>{sessions.length}</Text>
              <Text style={styles.summaryLabel}>fitxers detectats</Text>
            </View>
            <View style={[styles.summaryPill, readySessions.length > 0 && styles.summaryPillReady]}>
              <Text style={[styles.summaryNum, readySessions.length > 0 && styles.summaryNumReady]}>
                {readySessions.length}
              </Text>
              <Text style={[styles.summaryLabel, readySessions.length > 0 && styles.summaryLabelReady]}>
                desxifrats
              </Text>
            </View>
          </View>
        )}
      </View>

      {/* ── Sessions ──────────────────────────────────────────────────────── */}
      {sessions.length === 0 && checkStatus === 'done' && (
        <View style={styles.emptyState}>
          <Text style={styles.emptyIcon}>📭</Text>
          <Text style={styles.emptyText}>
            No s'han trobat fragments.{'\n'}
            Demana als altres dispositius que t'enviïn el seu paquet .shardsafe.json.
          </Text>
        </View>
      )}

      {sessions.map(session => {
        const have      = session.packages.length;
        const needed    = session.threshold;
        const ready     = have >= needed;
        const progress  = Math.min(have / needed, 1);
        const decrypted = results.get(session.fileId);
        const isDecrypting = decryptingId === session.fileId;

        return (
          <View key={session.fileId} style={[styles.sessionCard, ready && styles.sessionCardReady]}>

            {/* Capçalera */}
            <View style={styles.sessionHeader}>
              <Text style={styles.sessionStatus}>
                {decrypted ? '🔓' : ready ? '✅' : '⏳'}
              </Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.sessionFileName} numberOfLines={1}>
                  {session.originalName}
                </Text>
                <Text style={styles.sessionFileId} numberOfLines={1}>
                  {session.fileId}
                </Text>
              </View>
            </View>

            {/* Dots dels shards */}
            <View style={styles.shardsRow}>
              {Array.from({ length: session.totalShards }, (_, i) => {
                const shardNum = i + 1;
                const hasShard = session.packages.some(p => p.shardIndex === shardNum);
                return (
                  <View
                    key={shardNum}
                    style={[styles.shardDot, hasShard && styles.shardDotHave]}
                  >
                    <Text style={[styles.shardDotText, hasShard && styles.shardDotTextHave]}>
                      {shardNum}
                    </Text>
                  </View>
                );
              })}
            </View>

            {/* Progrés */}
            <View style={styles.progressBar}>
              <View
                style={[
                  styles.progressFill,
                  { width: `${progress * 100}%` as any },
                  ready && styles.progressFillReady,
                ]}
              />
            </View>
            <Text style={[styles.progressText, ready && styles.progressTextReady]}>
              {have}/{needed} fragments
              {ready
                ? ` — Llest ✓${have > needed ? ` (+${have - needed} extra)` : ''}`
                : ` — Falten ${needed - have}`}
            </Text>

            {/* Estat desxifrant */}
            {isDecrypting && (
              <View style={styles.decryptingRow}>
                <ActivityIndicator color="#4ECDC4" size="small" />
                <Text style={styles.decryptingText}>Reconstruint clau i desxifrant...</Text>
              </View>
            )}

            {/* Resultat */}
            {decrypted && !isDecrypting && (
              <View style={styles.resultArea}>

                {decrypted.type === 'text' && (
                  <View style={styles.textCard}>
                    <View style={styles.textCardHeader}>
                      <Text style={styles.textCardTitle} numberOfLines={1}>
                        📄 {session.originalName}
                      </Text>
                      <Text style={styles.contentBadge}>TEXT</Text>
                    </View>
                    <ScrollView style={styles.textViewer} nestedScrollEnabled>
                      <Text style={styles.textContent} selectable>
                        {decrypted.content}
                      </Text>
                    </ScrollView>
                  </View>
                )}

                {decrypted.type === 'image' && (
                  <View style={styles.textCard}>
                    <View style={styles.textCardHeader}>
                      <Text style={styles.textCardTitle} numberOfLines={1}>
                        🖼️ {session.originalName}
                      </Text>
                      <Text style={styles.contentBadge}>IMATGE</Text>
                    </View>
                    <Image
                      source={{ uri: decrypted.dataUri }}
                      style={styles.imageViewer}
                      resizeMode="contain"
                    />
                  </View>
                )}

                {decrypted.type === 'binary' && (
                  <View style={styles.binaryCard}>
                    <Text style={styles.binaryIcon}>✅</Text>
                    <Text style={styles.binaryTitle}>Desxifrat correctament</Text>
                    <Text style={styles.binaryMeta}>
                      {session.originalName.split('.').pop()?.toUpperCase()}
                      {'  ·  '}
                      {formatBytes(decrypted.size)}
                    </Text>
                  </View>
                )}

                <TouchableOpacity
                  style={styles.downloadBtn}
                  onPress={() => handleDownload(session)}
                >
                  <Text style={styles.downloadBtnText}>
                    {Platform.OS === 'web' ? '⬇ Descarregar fitxer' : '💾 Desar / Compartir'}
                  </Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        );
      })}

    </ScrollView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  content: { padding: 24, paddingBottom: 60 },

  header: { marginBottom: 36, marginTop: Platform.OS === 'ios' ? 20 : 8 },
  headerTitle: { fontSize: 32, fontWeight: '800', color: '#f0f0f0', letterSpacing: -0.5 },
  headerSub: { fontSize: 13, color: '#555', marginTop: 2, letterSpacing: 2, textTransform: 'uppercase' },

  section: { marginBottom: 28 },
  stepLabel: {
    fontSize: 11, fontWeight: '700', color: '#4ECDC4',
    letterSpacing: 3, textTransform: 'uppercase', marginBottom: 12,
  },
  accent: { color: '#4ECDC4', fontWeight: '700' },

  // Peers row
  peersRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  peerPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#111', borderWidth: 1, borderColor: '#1e1e1e',
    borderRadius: 20, paddingVertical: 6, paddingHorizontal: 10,
  },
  peerDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#2a5a54' },
  peerName: { color: '#666', fontSize: 12 },

  // Botó principal
  checkBtn: {
    backgroundColor: '#111', borderWidth: 1, borderColor: '#2a2a2a',
    borderRadius: 16, padding: 20, marginBottom: 14,
  },
  checkBtnChecking: { borderColor: '#1e3a3a' },
  checkBtnInner: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  checkBtnIcon: { fontSize: 28 },
  checkBtnText: { color: '#e0e0e0', fontSize: 16, fontWeight: '700' },
  checkBtnSub: { color: '#444', fontSize: 12, marginTop: 2 },

  // Resum
  summaryRow: { flexDirection: 'row', gap: 10 },
  summaryPill: {
    flex: 1, backgroundColor: '#111', borderWidth: 1, borderColor: '#1e1e1e',
    borderRadius: 12, padding: 12, alignItems: 'center', gap: 2,
  },
  summaryPillReady: { borderColor: '#1e3a3a', backgroundColor: '#0d1a1a' },
  summaryNum: { color: '#e0e0e0', fontSize: 22, fontWeight: '800' },
  summaryNumReady: { color: '#4ECDC4' },
  summaryLabel: { color: '#444', fontSize: 10, textAlign: 'center' },
  summaryLabelReady: { color: '#3a8a84' },

  // Buit
  emptyState: { alignItems: 'center', paddingVertical: 40, gap: 12 },
  emptyIcon: { fontSize: 40 },
  emptyText: { color: '#333', fontSize: 13, textAlign: 'center', lineHeight: 20 },

  // Sessió
  sessionCard: {
    backgroundColor: '#0f0f0f', borderWidth: 1, borderColor: '#1e1e1e',
    borderRadius: 16, padding: 16, marginBottom: 16,
  },
  sessionCardReady: { borderColor: '#1e3a3a' },
  sessionHeader: {
    flexDirection: 'row', alignItems: 'flex-start',
    gap: 10, marginBottom: 14,
  },
  sessionStatus: { fontSize: 22 },
  sessionFileName: { color: '#e0e0e0', fontWeight: '700', fontSize: 15, marginBottom: 3 },
  sessionFileId: {
    color: '#2a2a2a', fontSize: 10,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },

  // Shard dots
  shardsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 },
  shardDot: {
    width: 34, height: 34, borderRadius: 8,
    backgroundColor: '#161616', borderWidth: 1, borderColor: '#222',
    alignItems: 'center', justifyContent: 'center',
  },
  shardDotHave: { backgroundColor: '#0f2a2a', borderColor: '#4ECDC4' },
  shardDotText: { color: '#333', fontSize: 12, fontWeight: '700' },
  shardDotTextHave: { color: '#4ECDC4' },

  // Progrés
  progressBar: {
    height: 4, backgroundColor: '#1a1a1a',
    borderRadius: 2, overflow: 'hidden', marginBottom: 6,
  },
  progressFill: { height: '100%', backgroundColor: '#2a2a2a', borderRadius: 2 },
  progressFillReady: { backgroundColor: '#4ECDC4' },
  progressText: { color: '#444', fontSize: 12, fontWeight: '600', marginBottom: 12 },
  progressTextReady: { color: '#4ECDC4' },

  // Desxifrant
  decryptingRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10,
  },
  decryptingText: { color: '#3a8a84', fontSize: 13 },

  // Resultat
  resultArea: { gap: 10 },
  textCard: {
    backgroundColor: '#111', borderWidth: 1, borderColor: '#1e1e1e',
    borderRadius: 12, overflow: 'hidden',
  },
  textCardHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: 12, borderBottomWidth: 1, borderBottomColor: '#1e1e1e',
  },
  textCardTitle: { color: '#c0c0c0', fontSize: 13, fontWeight: '600', flex: 1 },
  contentBadge: {
    color: '#4ECDC4', fontSize: 9, fontWeight: '800', letterSpacing: 2,
    backgroundColor: '#0f1a1a', paddingHorizontal: 7, paddingVertical: 3, borderRadius: 4,
  },
  textViewer: { maxHeight: 280, padding: 12 },
  textContent: {
    color: '#888', fontSize: 12,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', lineHeight: 18,
  },
  imageViewer: { width: '100%', height: 260 },
  binaryCard: {
    backgroundColor: '#111', borderRadius: 12, padding: 20,
    alignItems: 'center', gap: 6,
  },
  binaryIcon: { fontSize: 34 },
  binaryTitle: { color: '#4ECDC4', fontWeight: '800', fontSize: 16 },
  binaryMeta: { color: '#555', fontSize: 12 },

  downloadBtn: {
    backgroundColor: '#4ECDC4', borderRadius: 10, padding: 14, alignItems: 'center',
  },
  downloadBtnText: { color: '#0a0a0a', fontSize: 14, fontWeight: '800' },
});