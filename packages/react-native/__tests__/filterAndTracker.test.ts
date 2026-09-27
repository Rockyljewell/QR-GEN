import { createBarcode } from '../src/barcode';
import { DuplicateFilter, barcodeKey } from '../src/duplicateFilter';
import { ScanSession } from '../src/session';
import { BarcodeTracker, DEFAULT_TRACKING_TIMEOUT, trackingId } from '../src/tracker';
import type { Barcode } from '../src/types';

const qr = (data: string, t = 0): Barcode => createBarcode({ data, symbology: 'qr', timestamp: t });
const ean = (data: string, t = 0): Barcode => createBarcode({ data, symbology: 'ean13', timestamp: t });

describe('DuplicateFilter', () => {
  it('suppresses repeats inside the window, measured from the last report', () => {
    const f = new DuplicateFilter(1000);
    expect(f.accept(qr('a'), 0)).toBe(true);
    expect(f.accept(qr('a'), 500)).toBe(false);
    expect(f.accept(qr('a'), 999)).toBe(false);
    expect(f.accept(qr('a'), 1000)).toBe(true);
    expect(f.accept(qr('a'), 1500)).toBe(false);
    expect(f.accept(qr('a'), 2000)).toBe(true);
  });

  it('keys on symbology and data', () => {
    const f = new DuplicateFilter(1000);
    expect(f.accept(qr('123'), 0)).toBe(true);
    expect(f.accept(ean('123'), 0)).toBe(true);
    expect(f.accept(qr('124'), 0)).toBe(true);
    expect(barcodeKey(qr('123'))).not.toBe(barcodeKey(ean('123')));
  });

  it('0 reports every frame', () => {
    const f = new DuplicateFilter(0);
    expect(f.filter([qr('a'), qr('a')], 0)).toHaveLength(2);
    expect(f.accept(qr('a'), 1)).toBe(true);
    expect(f.size).toBe(0);
  });

  it('-1 reports once per session until reset', () => {
    const f = new DuplicateFilter(-1);
    expect(f.accept(qr('a'), 0)).toBe(true);
    expect(f.accept(qr('a'), 10_000_000)).toBe(false);
    f.reset();
    expect(f.accept(qr('a'), 10_000_001)).toBe(true);
  });

  it('normalizes negative windows to -1 and NaN to the default', () => {
    expect(new DuplicateFilter(-5).window).toBe(-1);
    expect(new DuplicateFilter(Number.NaN).window).toBe(1000);
  });

  it('filters a frame in order and drops in-frame duplicates', () => {
    const f = new DuplicateFilter(1000);
    expect(f.filter([qr('a'), qr('b'), qr('a')], 0).map((b) => b.data)).toEqual(['a', 'b']);
  });

  it('cleans up old entries', () => {
    const f = new DuplicateFilter(100);
    for (let i = 0; i < 300; i++) f.accept(qr(String(i)), 0);
    f.accept(qr('late'), 1000);
    expect(f.size).toBeLessThan(300);
    expect(f.accept(qr('late'), 1001)).toBe(false);
  });
});

describe('trackingId', () => {
  it('is stable and depends on symbology and data', () => {
    expect(trackingId('qr', 'hello')).toBe(trackingId('qr', 'hello'));
    expect(trackingId('qr', 'hello')).not.toBe(trackingId('qr', 'hellp'));
    expect(trackingId('qr', 'x').startsWith('qr-')).toBe(true);
    expect(trackingId('ean13', 'x').startsWith('ean13-')).toBe(true);
  });

  it('uses FNV-1a 32', () => {
    // Reference values of FNV-1a 32: "" = 811c9dc5, "a" = e40c292c, "foobar" = bf9cf968.
    expect(trackingId('qr', '')).toBe('qr-811c9dc5');
    expect(trackingId('qr', 'a')).toBe('qr-e40c292c');
    expect(trackingId('qr', 'foobar')).toBe('qr-bf9cf968');
  });
});

describe('BarcodeTracker', () => {
  it('adds, updates and drops codes after 500 ms unseen', () => {
    const t = new BarcodeTracker();
    expect(t.timeout).toBe(DEFAULT_TRACKING_TIMEOUT);

    let u = t.update([qr('a'), qr('b')], 0);
    expect(u.added.map((x) => x.data)).toEqual(['a', 'b']);
    expect(u.tracked).toHaveLength(2);
    expect(u.changed).toBe(true);
    const idA = u.tracked[0]!.id;

    u = t.update([qr('a')], 300);
    expect(u.added).toHaveLength(0);
    expect(u.removed).toHaveLength(0);
    const a = u.tracked.find((x) => x.data === 'a')!;
    expect(a.id).toBe(idA);
    expect(a.count).toBe(2);
    expect(a.firstSeen).toBe(0);
    expect(a.lastSeen).toBe(300);

    u = t.update([qr('a')], 501);
    expect(u.removed.map((x) => x.data)).toEqual(['b']);
    expect(u.tracked.map((x) => x.data)).toEqual(['a']);

    u = t.prune(900);
    expect(u.changed).toBe(false);
    u = t.prune(1002);
    expect(u.removed.map((x) => x.data)).toEqual(['a']);
    expect(u.changed).toBe(true);
    expect(t.size).toBe(0);
  });

  it('keeps a code exactly at the timeout and counts once per frame', () => {
    const t = new BarcodeTracker({ timeout: 500 });
    t.update([qr('a'), qr('a')], 0);
    expect(t.tracked[0]!.count).toBe(1);
    expect(t.prune(500).removed).toHaveLength(0);
    expect(t.prune(501).removed).toHaveLength(1);
  });

  it('refreshes location with the latest sighting', () => {
    const t = new BarcodeTracker();
    t.update([qr('a', 1)], 0);
    const moved = { ...qr('a', 2), location: { topLeft: { x: 5, y: 5 }, topRight: { x: 9, y: 5 }, bottomRight: { x: 9, y: 9 }, bottomLeft: { x: 5, y: 9 } } };
    const u = t.update([moved], 100);
    expect(u.tracked[0]!.location.topLeft).toEqual({ x: 5, y: 5 });
    expect(u.tracked[0]!.timestamp).toBe(2);
  });

  it('reset clears everything', () => {
    const t = new BarcodeTracker();
    t.update([qr('a')], 0);
    t.reset();
    expect(t.tracked).toEqual([]);
  });
});

describe('ScanSession', () => {
  it('single mode stops after the first accepted scan', () => {
    const s = new ScanSession({ mode: 'single' });
    expect(s.process([], 0).stop).toBe(false);
    const r = s.process([qr('a')], 10);
    expect(r.scanned.map((b) => b.data)).toEqual(['a']);
    expect(r.stop).toBe(true);
    expect(s.stopped).toBe(true);
    expect(s.process([qr('b')], 20).scanned).toEqual([]);
    s.resume();
    // Still inside the duplicate window for 'a'.
    expect(s.process([qr('a')], 30).scanned).toEqual([]);
    expect(s.process([qr('b')], 40).scanned.map((b) => b.data)).toEqual(['b']);
  });

  it('continuous mode applies the duplicate filter', () => {
    const s = new ScanSession({ mode: 'continuous', duplicateFilter: 1000 });
    expect(s.process([qr('a')], 0).scanned).toHaveLength(1);
    expect(s.process([qr('a')], 100).scanned).toHaveLength(0);
    expect(s.process([qr('a')], 1100).scanned).toHaveLength(1);
    expect(s.process([qr('a')], 1200).tracked).toBeNull();
  });

  it('batch mode tracks and ticks', () => {
    const s = new ScanSession({ mode: 'batch', duplicateFilter: -1 });
    let r = s.process([qr('a'), qr('b')], 0);
    expect(r.scanned).toHaveLength(2);
    expect(r.tracked).toHaveLength(2);
    r = s.process([qr('a'), qr('b')], 100);
    expect(r.scanned).toHaveLength(0);
    expect(r.tracked).toHaveLength(2);
    expect(s.tick(400)).toBeNull();
    expect(s.tick(601)).toEqual([]);
  });

  it('configure changes mode and window; reset starts a new session', () => {
    const s = new ScanSession({ mode: 'single', duplicateFilter: -1 });
    s.process([qr('a')], 0);
    expect(s.stopped).toBe(true);
    s.configure({ mode: 'continuous' });
    expect(s.stopped).toBe(false);
    expect(s.process([qr('a')], 10).scanned).toHaveLength(0);
    s.reset();
    expect(s.process([qr('a')], 20).scanned).toHaveLength(1);
    s.configure({ duplicateFilter: 0 });
    expect(s.process([qr('a')], 21).scanned).toHaveLength(1);
    expect(s.tick(10_000)).toBeNull();
  });
});
