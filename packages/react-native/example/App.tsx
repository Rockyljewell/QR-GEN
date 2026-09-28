// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0
/**
 * qrgen-react-native example: a scanner screen with a mode switch, a torch
 * toggle, a back end switch (vision-camera or WebView) and a result list.
 *
 * Drop this file into an Expo development build or a bare React Native app
 * that has react-native-vision-camera (and optionally react-native-webview)
 * installed.
 */
import { useCallback, useRef, useState } from 'react';
import { FlatList, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import {
  QRGenScanner,
  QRGenWebScanner,
  QRGEN_ACCENT_COLOR,
  type Barcode,
  type QRGenError,
  type QRGenScannerHandle,
  type ScanMode,
  type TrackedBarcode,
} from 'qrgen-react-native';

const MODES: ScanMode[] = ['single', 'continuous', 'batch'];

type Backend = 'native' | 'web';

interface ResultRow {
  key: string;
  barcode: Barcode;
}

export default function App() {
  const [mode, setMode] = useState<ScanMode>('continuous');
  const [backend, setBackend] = useState<Backend>('native');
  const [torch, setTorch] = useState(false);
  const [results, setResults] = useState<ResultRow[]>([]);
  const [tracked, setTracked] = useState<TrackedBarcode[]>([]);
  const [error, setError] = useState<QRGenError | null>(null);
  const scanner = useRef<QRGenScannerHandle>(null);
  const counter = useRef(0);

  const onScan = useCallback((barcodes: Barcode[]) => {
    setError(null);
    setResults((prev) =>
      [...barcodes.map((barcode) => ({ key: String(++counter.current), barcode })), ...prev].slice(0, 50),
    );
  }, []);

  const scanAgain = useCallback(() => scanner.current?.start(), []);

  const common = {
    style: styles.scanner,
    symbologies: ['all'],
    mode,
    torch,
    accentColor: QRGEN_ACCENT_COLOR,
    onScan,
    onTrack: setTracked,
    onError: setError,
  } as const;

  return (
    <SafeAreaView style={styles.screen}>
      {backend === 'native' ? <QRGenScanner ref={scanner} {...common} /> : <QRGenWebScanner {...common} />}

      <View style={styles.controls}>
        <View style={styles.segmented}>
          {MODES.map((m) => (
            <Pressable key={m} onPress={() => setMode(m)} style={[styles.segment, mode === m && styles.segmentActive]}>
              <Text style={[styles.segmentText, mode === m && styles.segmentTextActive]}>{m}</Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.row}>
          <Chip label={torch ? 'Torch on' : 'Torch off'} onPress={() => setTorch((t) => !t)} />
          <Chip label={backend === 'native' ? 'Vision Camera' : 'WebView'} onPress={() => setBackend((b) => (b === 'native' ? 'web' : 'native'))} />
          {mode === 'single' && backend === 'native' ? <Chip label="Scan again" onPress={scanAgain} /> : null}
          <Chip label="Clear" onPress={() => setResults([])} />
        </View>
        {error ? <Text style={styles.error}>{`${error.code}: ${error.message}`}</Text> : null}
        {mode === 'batch' ? <Text style={styles.meta}>{`${tracked.length} code(s) in view`}</Text> : null}
      </View>

      <FlatList
        style={styles.list}
        data={results}
        keyExtractor={(item) => item.key}
        ListEmptyComponent={<Text style={styles.empty}>Point the camera at a barcode or QR code.</Text>}
        renderItem={({ item }) => (
          <View style={styles.item}>
            <Text style={styles.itemType}>{item.barcode.symbologyName}</Text>
            <Text style={styles.itemData} numberOfLines={2}>
              {item.barcode.data}
            </Text>
          </View>
        )}
      />
    </SafeAreaView>
  );
}

function Chip({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.chip}>
      <Text style={styles.chipText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0B0F14' },
  scanner: { flex: 3 },
  controls: { paddingHorizontal: 16, paddingTop: 12, gap: 10 },
  segmented: { flexDirection: 'row', backgroundColor: '#1F2937', borderRadius: 999, padding: 4 },
  segment: { flex: 1, paddingVertical: 8, borderRadius: 999, alignItems: 'center' },
  segmentActive: { backgroundColor: QRGEN_ACCENT_COLOR },
  segmentText: { color: '#D1D5DB', fontWeight: '600', textTransform: 'capitalize' },
  segmentTextActive: { color: '#0B0F14' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: '#374151' },
  chipText: { color: '#E5E7EB' },
  error: { color: '#FCA5A5' },
  meta: { color: '#9CA3AF' },
  list: { flex: 2, marginTop: 8 },
  empty: { color: '#6B7280', textAlign: 'center', marginTop: 24 },
  item: { paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#1F2937' },
  itemType: { color: QRGEN_ACCENT_COLOR, fontSize: 12, fontWeight: '700', textTransform: 'uppercase' },
  itemData: { color: '#F9FAFB', fontSize: 16, marginTop: 2 },
});
