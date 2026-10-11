// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

import { createBarcode } from '../src/barcode';
import { ScanSession } from '../src/session';
import type { ScanSessionOptions } from '../src/session';
import { BarcodeTracker, trackingId } from '../src/tracker';
import type { Barcode, Size } from '../src/types';

const BASE = 1_800_000_000_000;
const FRAME = { width: 1000, height: 1000 };
const code = (x = 100, data = 'same', frameSize: Size = FRAME): Barcode => createBarcode({
  data, symbology: 'qr', timestamp: 77, frameSize: { ...frameSize },
  location: { topLeft: { x, y: 100 }, topRight: { x: x + 40, y: 100 },
    bottomRight: { x: x + 40, y: 140 }, bottomLeft: { x, y: 140 } },
});
const spatial = (options: ScanSessionOptions = {}): ScanSession => new ScanSession({ mode: 'batch', spatialTracking: true, ...options });
const state = (session: ScanSession): string => JSON.stringify(session, (_, value: unknown) =>
  value instanceof Map ? [...value] : value instanceof Set ? [...value] : value);
const raw = (session: ScanSession): BarcodeTracker => (session as unknown as { tracker: BarcodeTracker }).tracker;
const performanceClock = (): { now(): number } => (globalThis as typeof globalThis & { performance: { now(): number } }).performance;

beforeEach(() => jest.useFakeTimers({ now: BASE }));
afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });

describe('spatial session policy and public IDs', () => {
  it.each([undefined, false])('keeps default payload grouping and permissive geometry with policy %p', spatialTracking => {
    const session = new ScanSession({ mode: 'batch', spatialTracking });
    const input = createBarcode({ data: 'same', symbology: 'qr', timestamp: 77 });
    const ignoredSize = { get width(): number { throw new Error('ignored size'); }, height: 0 };
    const result = session.process([input, input], 0, ignoredSize);
    expect(result.scanned).toEqual([input]);
    expect(result.scanned[0]).toBe(input);
    expect(result.tracked).toHaveLength(1);
    expect(result.tracked![0]!.id).toBe(trackingId('qr', 'same'));
    expect(result.tracked![0]!.count).toBe(1);
    expect(session.resetSpatial()).toBeNull();
    expect(session.tracked).toEqual(result.tracked);
  });

  it.each([1000, -1, 0])('separates observations independently of duplicate window %p', duplicateFilter => {
    const session = spatial({ duplicateFilter });
    const first = session.process([code(100), code(500)], 0);
    expect(first.scanned).toHaveLength(duplicateFilter === 0 ? 2 : 1);
    expect(first.tracked!.map(b => b.id)).toEqual(['spatial-0:spatial-1', 'spatial-0:spatial-2']);
    const second = session.process([code(501), code(101)], 1);
    expect(second.scanned).toHaveLength(duplicateFilter === 0 ? 2 : 0);
    expect(second.tracked!.map(b => [b.id, b.location.topLeft.x, b.count])).toEqual([
      ['spatial-0:spatial-1', 101, 2], ['spatial-0:spatial-2', 501, 2],
    ]);
    expect(session.tracked).toEqual(second.tracked);
  });

  it('forwards a zero movement gate and construction timeout', () => {
    const session = spatial({ trackMaxJump: 0, trackingTimeout: 9 });
    const old = session.process([code()], 0).tracked![0]!;
    const next = session.process([code(101)], 1).tracked!;
    expect(next.map(b => b.id)).toEqual([old.id, 'spatial-0:spatial-2']);
    expect(session.tick(9)).toBeNull();
    expect(session.tick(10)!.map(b => b.id)).toEqual(['spatial-0:spatial-2']);
    expect(session.tick(11)).toEqual([]);
  });

  it('keeps equal policy/history, and prefixes replacements on every output path', () => {
    const session = spatial({ duplicateFilter: -1 });
    const first = session.process([code()], 0).tracked![0]!;
    session.configure({ spatialTracking: true, trackMaxJump: 3, trackMaxAssociationWork: 250_000 });
    const equal = session.process([code(101)], 1);
    expect(equal.scanned).toEqual([]);
    expect(equal.tracked![0]!.id).toBe(first.id);
    expect(equal.tracked![0]!.count).toBe(2);
    session.configure({ trackMaxJump: 4 });
    expect(session.trackMaxJump).toBe(4);
    expect(session.tracked).toEqual([]);
    const replaced = session.process([code()], 2);
    expect(replaced.scanned).toEqual([]);
    expect(replaced.tracked![0]!.id).toBe('spatial-1:spatial-1');
    expect(session.tracked[0]!.id).toBe('spatial-1:spatial-1');
    session.process([code(500, 'later')], 400);
    expect(session.tick(503)!.map(b => b.id)).toEqual(['spatial-1:spatial-2']);
  });

  it('preserves duplicate history through disable/re-enable and retains default IDs', () => {
    const session = spatial({ duplicateFilter: -1 });
    session.process([code()], 0);
    session.configure({ spatialTracking: false });
    expect(session.spatialTracking).toBe(false);
    const payload = session.process([code()], 1);
    expect(payload.scanned).toEqual([]);
    expect(payload.tracked![0]!.id).toBe(trackingId('qr', 'same'));
    session.configure({ spatialTracking: true, trackMaxAssociationWork: 16 });
    const again = session.process([code()], 2);
    expect(again.scanned).toEqual([]);
    expect(again.tracked![0]!.id).toBe('spatial-2:spatial-1');
    expect(session.trackMaxAssociationWork).toBe(16);
  });

  const invalid: ScanSessionOptions[] = [
    { spatialTracking: 1 as unknown as boolean }, { spatialTracking: null as unknown as boolean },
    ...[NaN, Infinity, -Infinity, -1, '3'].map(value => ({ trackMaxJump: value as number })),
    ...[0, -1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1, '16'].map(value => ({ trackMaxAssociationWork: value as number })),
  ];
  it.each(invalid)('rejects policy %p before changing mode/window/history', options => {
    expect(() => spatial(options)).toThrow();
    const session = spatial({ duplicateFilter: -1 });
    session.process([code()], 0);
    const before = state(session);
    expect(() => session.configure({ mode: 'single', duplicateFilter: 0, ...options })).toThrow();
    expect(state(session)).toBe(before);
    expect(session.process([code()], 1).scanned).toEqual([]);
  });

  it('reads configure getters once before committing any option', () => {
    const session = spatial({ duplicateFilter: -1 });
    session.process([code()], 0);
    const reads: Record<string, number> = {};
    const values: ScanSessionOptions = { mode: 'batch', duplicateFilter: -1,
      spatialTracking: true, trackMaxJump: 3, trackMaxAssociationWork: 250_000 };
    const options = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value]));
    for (const [key, value] of Object.entries(values)) Object.defineProperty(options, key, { enumerable: true, get() {
      reads[key] = (reads[key] ?? 0) + 1;
      if (reads[key]! > 1) throw new Error('repeated option read');
      return value;
    } });
    session.configure(options);
    expect(Object.values(reads)).toEqual([1, 1, 1, 1, 1]);
    session.configure({ get trackingTimeout(): number { throw new Error('ignored timeout'); } });
    const before = state(session);
    expect(() => session.configure({ mode: 'single', duplicateFilter: 0,
      get trackMaxAssociationWork(): number { throw new Error('late option'); } })).toThrow('late option');
    expect(state(session)).toBe(before);
    expect(session.process([code()], 1).scanned).toEqual([]);
    expect(session.tick(500)).toBeNull();
    expect(session.tick(502)).toEqual([]); // configure timeout remains ignored.
  });

  it('rejects generation exhaustion before configuration changes, but allows equal policy', () => {
    const session = spatial({ duplicateFilter: -1 });
    session.process([code()], 0);
    (session as unknown as { policyGeneration: number }).policyGeneration = Number.MAX_SAFE_INTEGER;
    const before = state(session);
    session.configure({ trackMaxJump: 3 });
    expect(state(session)).toBe(before);
    expect(() => session.configure({ mode: 'single', duplicateFilter: 0, trackMaxJump: 4 })).toThrow('generation');
    expect(state(session)).toBe(before);
    expect(session.process([code()], 1).scanned).toEqual([]);
  });
});

describe('canonical whole-frame validation and filter transactions', () => {
  it('preserves structural class/prototype and non-enumerable metadata with one read each', () => {
    const base = code();
    const reads = new Map<keyof Barcode, number>();
    const read = <K extends keyof Barcode>(key: K): Barcode[K] => {
      reads.set(key, (reads.get(key) ?? 0) + 1);
      if (reads.get(key)! > 1) throw new Error(`second ${key}`);
      return base[key];
    };
    class PrototypeBarcode implements Barcode {
      extraMetadata = 'kept';
      get data() { return read('data'); }
      get symbology() { return read('symbology'); }
      get symbologyName() { return read('symbologyName'); }
      get rawBytes() { return read('rawBytes'); }
      get contentType() { return read('contentType'); }
      get isGS1() { return read('isGS1'); }
      get location() { return read('location'); }
      get frameSize() { return read('frameSize'); }
      get orientation() { return read('orientation'); }
      get ecLevel() { return read('ecLevel'); }
      get symbologyIdentifier() { return read('symbologyIdentifier'); }
      get timestamp() { return read('timestamp'); }
    }
    const input = new PrototypeBarcode();
    Object.defineProperty(input, 'rawBytes', { get: () => read('rawBytes'), enumerable: false });
    const result = spatial().process([input], 0);
    expect(result.scanned[0]).toMatchObject({ ...base, extraMetadata: 'kept' });
    expect(result.tracked![0]).toMatchObject({ ...base, extraMetadata: 'kept' });
    expect(reads.size).toBe(Object.keys(base).length);
    expect([...reads.values()].every(value => value === 1)).toBe(true);
  });

  it('uses one coherent caller snapshot for filtering and tracking', () => {
    const session = spatial();
    const input = code();
    const reads: Record<string, number> = {};
    const once = <T>(key: string, value: T): T => {
      reads[key] = (reads[key] ?? 0) + 1;
      if (reads[key]! > 1) throw new Error(`second ${key}`);
      return value;
    };
    Object.defineProperty(input, 'data', { enumerable: true, get: () => once('data', 'canonical') });
    Object.defineProperty(input, 'symbologyName', { enumerable: true, get: () => once('metadata', 'QR Code') });
    const q = input.location;
    Object.defineProperty(input, 'location', { enumerable: true, get: () => once('location', q) });
    Object.defineProperty(q.topLeft, 'x', { enumerable: true, get: () => once('point', 100) });
    const size = input.frameSize;
    Object.defineProperty(size, 'width', { enumerable: true, get: () => once('record size', 1000) });
    const explicit = { get width(): number { return once('explicit size', 1000); }, height: 1000 };
    const result = session.process([input], 0, explicit);
    expect(result.scanned[0]!.data).toBe('canonical');
    expect(result.tracked![0]!.data).toBe('canonical');
    expect(Object.values(reads).every(value => value === 1)).toBe(true);
    q.topRight.x = 999;
    result.scanned[0]!.location.bottomRight.x = 888;
    expect(session.tracked[0]!.location.topRight.x).toBe(140);
    expect(session.tracked[0]!.location.bottomRight.x).toBe(140);
  });

  const malformed: Array<[string, (barcode: Barcode) => void]> = [
    ['point', b => { b.location.topLeft.x = NaN; }],
    ['missing size', b => { b.frameSize = undefined as unknown as Size; }],
    ['mixed size', b => { b.frameSize.width = 800; }],
    ['nonstring key', b => { b.data = 9 as unknown as string; }],
    ['late metadata', b => { Object.defineProperty(b, 'ecLevel', { enumerable: true, get() { throw new Error('late metadata'); } }); }],
    ['non-enumerable metadata', b => { Object.defineProperty(b, 'ecLevel', { enumerable: false, get() { throw new Error('non-enumerable metadata'); } }); }],
    ['late nested getter', b => { Object.defineProperty(b.location.bottomLeft, 'y', { enumerable: true, get() { throw new Error('late nested getter'); } }); }],
  ];
  it.each(malformed)('rejects the complete frame for %s without expiry, IDs, or duplicate consumption', (_, corrupt) => {
    const session = spatial({ duplicateFilter: -1 });
    const old = session.process([code()], 0).tracked;
    const bad = code(500, 'bad');
    corrupt(bad);
    const before = state(session);
    const wall = jest.spyOn(Date, 'now');
    const elapsed = jest.spyOn(performanceClock(), 'now');
    expect(() => session.process([code(300, 'new'), bad], 501)).toThrow();
    expect(state(session)).toBe(before);
    expect(wall).not.toHaveBeenCalled();
    expect(elapsed).not.toHaveBeenCalled();
    expect(session.tracked).toEqual(old);
    const recovered = session.process([code(300, 'new')], 501);
    expect(recovered.scanned.map(b => b.data)).toEqual(['new']);
    expect(recovered.tracked![0]!.id).toBe('spatial-0:spatial-2');
  });

  it('materializes raising iterators and explicit size getters before either clock/history', () => {
    const session = spatial({ duplicateFilter: -1 });
    session.process([code()], 0);
    const before = state(session);
    const wall = jest.spyOn(Date, 'now');
    const elapsed = jest.spyOn(performanceClock(), 'now');
    const raising = { *[Symbol.iterator]() { yield code(300, 'new'); throw new Error('late iterator'); } };
    expect(() => session.process(raising as unknown as readonly Barcode[], 501)).toThrow('late iterator');
    expect(() => session.process([code(300, 'new')], 501,
      { width: 1000, get height(): number { throw new Error('late size'); } })).toThrow('late size');
    expect(state(session)).toBe(before);
    expect(wall).not.toHaveBeenCalled();
    expect(elapsed).not.toHaveBeenCalled();
    expect(session.process([code(300, 'new')], 501).tracked![0]!.id).toBe('spatial-0:spatial-2');
  });

  it('does not let an explicit frame size fill missing per-record dimensions', () => {
    const session = spatial();
    const input = code();
    input.frameSize = undefined as unknown as Size;
    expect(() => session.process([input], 0, FRAME)).toThrow('dimensions');
    expect(session.tracked).toEqual([]);
    expect(session.process([code()], 0).tracked![0]!.id).toBe('spatial-0:spatial-1');
  });

  it('forwards the exact summed work boundary and does not commit a prepared filter on rejection', () => {
    const rejected = spatial({ duplicateFilter: -1, trackMaxAssociationWork: 15 });
    const accepted = spatial({ trackMaxAssociationWork: 16 });
    for (const session of [rejected, accepted]) session.process([code(100), code(500)], 0);
    const before = state(rejected);
    expect(() => rejected.process([code(300, 'new'), code(101), code(501)], 1)).toThrow('work 16');
    expect(state(rejected)).toBe(before);
    expect(accepted.process([code(101), code(501)], 1).tracked!.map(b => b.count)).toEqual([2, 2]);
    const recovery = rejected.process([code(300, 'new')], 2);
    expect(recovery.scanned.map(b => b.data)).toEqual(['new']);
    expect(recovery.tracked!.map(b => [b.id, b.count])).toEqual([
      ['spatial-0:spatial-1', 1], ['spatial-0:spatial-2', 1], ['spatial-0:spatial-3', 1],
    ]);
  });

  it.each(['expiry', 'resize'])('keeps rejected filter source/history and admits zero-work %s recovery', boundary => {
    const session = spatial({ trackMaxAssociationWork: 15 });
    session.process([code(100), code(500)], BASE);
    jest.advanceTimersByTime(100);
    const before = state(session);
    expect(() => session.process([code(300, 'new'), code(101), code(501)])).toThrow('work 16');
    expect(state(session)).toBe(before);
    if (boundary === 'expiry') jest.advanceTimersByTime(401);
    const frame = boundary === 'resize' ? { width: 800, height: 600 } : FRAME;
    const recovery = session.process([code(300, 'new', frame), code(101, 'same', frame), code(501, 'same', frame)], undefined, frame);
    expect(recovery.scanned.map(b => b.data)).toEqual(['new']);
    expect(recovery.tracked!.map(b => b.id)).toEqual(['spatial-0:spatial-3', 'spatial-0:spatial-4', 'spatial-0:spatial-5']);
    expect(recovery.tracked!.every(b => b.count === 1)).toBe(true);
  });

  it('discards the filter plan after late retained-count overflow and keeps planned IDs', () => {
    const session = spatial({ duplicateFilter: -1 });
    session.process([code()], BASE);
    raw(session).tracked[0]!.count = Number.MAX_SAFE_INTEGER;
    jest.advanceTimersByTime(100);
    const before = state(session);
    expect(() => session.process([code(500, 'new'), code()])).toThrow('count');
    expect(state(session)).toBe(before);
    raw(session).tracked[0]!.count = 1;
    const recovery = session.process([code(500, 'new'), code()]);
    expect(recovery.scanned.map(b => b.data)).toEqual(['new']);
    expect(recovery.tracked!.map(b => [b.id, b.count])).toEqual([['spatial-0:spatial-1', 2], ['spatial-0:spatial-2', 1]]);
  });

  it('discards the filter plan when externally changed retained geometry is invalid', () => {
    const session = spatial({ duplicateFilter: -1 });
    session.process([code()], 0);
    session.tracked[0]!.location.topLeft.x = NaN;
    const before = state(session);
    expect(() => session.process([code(500, 'new')], 501)).toThrow('coordinates');
    expect(state(session)).toBe(before);
    session.tracked[0]!.location.topLeft.x = 100;
    expect(session.process([code(500, 'new')], 501).scanned.map(b => b.data)).toEqual(['new']);
  });

  it.each(['throw', 'nonfinite'])('rejects a second tracker clock %s after filter preparation without committing either', failure => {
    const session = spatial({ duplicateFilter: -1 });
    session.process([code()], BASE);
    jest.advanceTimersByTime(100);
    const before = state(session);
    const timer = jest.spyOn(performanceClock(), 'now').mockReturnValueOnce(100).mockImplementationOnce(() => {
      if (failure === 'throw') throw new Error('second clock');
      return NaN;
    });
    expect(() => session.process([code(500, 'new')])).toThrow(failure === 'throw' ? 'second clock' : 'clocks');
    expect(timer).toHaveBeenCalledTimes(2);
    expect(state(session)).toBe(before);
    timer.mockRestore();
    const recovery = session.process([code(500, 'new')]);
    expect(recovery.scanned.map(b => b.data)).toEqual(['new']);
    expect(recovery.tracked![recovery.tracked!.length - 1]!.id).toBe('spatial-0:spatial-2');
  });

  it.each([NaN, Infinity, -Infinity])('rejects the first nonfinite filter clock %p before tracker update', value => {
    const session = spatial();
    session.process([code()], BASE);
    const before = state(session);
    const timer = jest.spyOn(performanceClock(), 'now').mockReturnValue(value);
    expect(() => session.process([code(500, 'new')])).toThrow('finite');
    expect(timer).toHaveBeenCalledTimes(1);
    expect(state(session)).toBe(before);
  });

  it.each([NaN, Infinity, -Infinity])('rejects nonfinite filter epoch %p before tracker update', value => {
    const session = spatial();
    session.process([code()], BASE);
    const before = state(session);
    const wall = jest.spyOn(Date, 'now').mockReturnValue(value);
    expect(() => session.process([code(500, 'new')])).toThrow('finite');
    expect(wall).toHaveBeenCalledTimes(1);
    expect(state(session)).toBe(before);
  });

  it('rejects a throwing first filter clock before expiry or ID allocation', () => {
    const session = spatial({ duplicateFilter: -1 });
    session.process([code()], BASE);
    const before = state(session);
    const wall = jest.spyOn(Date, 'now').mockImplementation(() => { throw new Error('first clock'); });
    expect(() => session.process([code(500, 'new')])).toThrow('first clock');
    expect(state(session)).toBe(before);
    wall.mockRestore();
    expect(session.process([code(500, 'new')], BASE + 501).tracked![0]!.id).toBe('spatial-0:spatial-2');
  });

  it('rejects finite-clock duplicate rebase overflow even after only tracker history was cleared', () => {
    const session = spatial({ duplicateFilter: -1 });
    session.process([code()], Number.MAX_VALUE);
    expect(session.resetSpatial()).toEqual([]);
    const before = state(session);
    const wall = jest.spyOn(Date, 'now').mockReturnValue(-Number.MAX_VALUE);
    expect(() => session.process([code(500, 'new')])).toThrow('elapsed history');
    expect(state(session)).toBe(before);
    wall.mockRestore();
    const recovery = session.process([code(500, 'new')], Number.MAX_VALUE);
    expect(recovery.scanned.map(b => b.data)).toEqual(['new']);
    expect(recovery.tracked![0]!.id).toBe('spatial-0:spatial-2');
  });
});

describe('reset, size and mode boundaries', () => {
  it.each([-1, 1000])('spatial-only reset preserves duplicate window %p and fresh observation IDs', duplicateFilter => {
    const session = spatial({ duplicateFilter });
    session.process([code()], 0);
    const wall = jest.spyOn(Date, 'now');
    const timer = jest.spyOn(performanceClock(), 'now');
    expect(session.resetSpatial()).toEqual([]);
    expect(session.resetSpatial()).toBeNull();
    expect(wall).not.toHaveBeenCalled();
    expect(timer).not.toHaveBeenCalled();
    const returning = session.process([code()], 1);
    expect(returning.scanned).toEqual([]);
    expect(returning.tracked![0]!.id).toBe('spatial-0:spatial-2');
    session.reset();
    const full = session.process([code()], 2);
    expect(full.scanned).toHaveLength(1);
    expect(full.tracked![0]!.id).toBe('spatial-0:spatial-3');
  });

  it('retains the duplicate clock source across spatial reset', () => {
    const session = spatial();
    session.process([code()], BASE);
    session.resetSpatial();
    jest.advanceTimersByTime(100);
    jest.setSystemTime(BASE + 60_100);
    // Explicit -> default rebases by epoch age; resetting the filter clock would
    // incorrectly compare a retained epoch observation against monotonic 100.
    expect(session.process([code()]).scanned).toHaveLength(1);
  });

  it('delivers blank-resize removal once and keeps payload duplicate history', () => {
    const session = spatial({ duplicateFilter: -1 });
    session.process([code()], 0);
    const resize = { width: 800, height: 600 };
    expect(session.process([], 1, resize)).toEqual({ scanned: [], tracked: [], stop: false });
    expect(session.process([], 2, resize).tracked).toBeNull();
    const returning = session.process([code(100, 'same', resize)], 3, resize);
    expect(returning.scanned).toEqual([]);
    expect(returning.tracked![0]!.id).toBe('spatial-0:spatial-2');
    expect(session.tick(503)).toBeNull();
    expect(session.tick(504)).toEqual([]);
    expect(session.tick(504)).toBeNull();
  });

  it('rejects blank invalid size without committing expiry or known dimensions', () => {
    const session = spatial();
    const old = session.process([code()], 0).tracked;
    const before = state(session);
    expect(() => session.process([], 501, { width: 0, height: 1000 })).toThrow('dimensions');
    expect(state(session)).toBe(before);
    expect(session.tracked).toEqual(old);
    expect(session.tick(501)).toEqual([]);
  });

  it('preserves stopped status and ignores new frame getters after single completion', () => {
    const session = spatial({ mode: 'single', duplicateFilter: -1 });
    const permissive = createBarcode({ data: 'same', symbology: 'qr', timestamp: 77 });
    expect(session.process([permissive], 0).stop).toBe(true);
    expect(session.resetSpatial()).toBeNull();
    expect(session.stopped).toBe(true);
    const input = { get [Symbol.iterator](): never { throw new Error('stopped input'); } };
    expect(session.process(input as unknown as readonly Barcode[])).toEqual({ scanned: [], tracked: null, stop: false });
    session.configure({ trackMaxJump: 4 });
    expect(session.stopped).toBe(true);
    session.resume();
    expect(session.process([permissive], 1).scanned).toEqual([]);
    session.reset();
    expect(session.process([permissive], 2).stop).toBe(true);
  });

  it('mode changes preserve duplicate history and the same policy-generation/core ordinal', () => {
    const session = spatial({ duplicateFilter: -1 });
    session.process([code()], 0);
    session.configure({ mode: 'continuous' });
    expect(session.tracked).toEqual([]);
    const permissive = createBarcode({ data: 'same', symbology: 'qr', timestamp: 77 });
    expect(session.process([permissive], 1).scanned).toEqual([]);
    expect(session.tick(5000)).toBeNull();
    session.configure({ mode: 'batch' });
    const returning = session.process([code()], 2);
    expect(returning.scanned).toEqual([]);
    expect(returning.tracked![0]!.id).toBe('spatial-0:spatial-2');
  });
});

describe('spatial session duration and epoch metadata', () => {
  const scenarios = [
    { name: 'wall rollback after expiry', elapsed: 2000, step: -60_000, expired: true, reported: true },
    { name: 'wall forward before expiry', elapsed: 100, step: 60_000, expired: false, reported: false },
  ];
  it.each(scenarios)('uses monotonic frame windows through $name', ({ elapsed, step, expired, reported }) => {
    const session = spatial();
    const first = session.process([code()]).tracked![0]!;
    jest.advanceTimersByTime(elapsed);
    jest.setSystemTime(BASE + elapsed + step);
    const next = session.process([code(101)]);
    expect(next.scanned).toHaveLength(reported ? 1 : 0);
    expect(next.tracked![0]!.id).toBe(expired ? 'spatial-0:spatial-2' : first.id);
    expect(next.tracked![0]!.firstSeen).toBe(expired ? BASE + elapsed + step : BASE);
    expect(next.tracked![0]!.lastSeen).toBe(BASE + elapsed + step);
    expect(next.tracked![0]!.timestamp).toBe(77);
  });

  it.each(scenarios)('uses monotonic timer expiry through $name', ({ elapsed, step, expired }) => {
    const session = spatial();
    session.process([code()]);
    jest.advanceTimersByTime(elapsed);
    jest.setSystemTime(BASE + elapsed + step);
    expect(session.tick()).toEqual(expired ? [] : null);
  });

  it('keeps exact tracking and duplicate boundaries across injected/default source transitions', () => {
    const session = spatial();
    session.process([code()], BASE);
    jest.advanceTimersByTime(500);
    expect(session.tick()).toBeNull();
    jest.advanceTimersByTime(1);
    expect(session.tick(BASE + 501)).toEqual([]);
    expect(session.process([code()], BASE + 999).scanned).toEqual([]);
    expect(session.process([code()], BASE + 1000).scanned).toHaveLength(1);
  });

  it('keeps zero-window history empty and lets only tracker sample default time', () => {
    const session = spatial({ duplicateFilter: 0 });
    const clock = jest.spyOn(performanceClock(), 'now');
    expect(session.process([code(), code(500)]).scanned).toHaveLength(2);
    expect(clock).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(100);
    jest.setSystemTime(BASE - 60_000);
    expect(session.process([code(), code(500)]).scanned).toHaveLength(2);
    expect(session.tracked.map(b => b.count)).toEqual([2, 2]);
  });

  it('preserves timestamp age through unsupported wall fallback and restored monotonic source', () => {
    const session = spatial();
    session.process([code()], BASE);
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'performance')!;
    try {
      Object.defineProperty(globalThis, 'performance', { value: undefined, configurable: true });
      jest.advanceTimersByTime(500);
      expect(session.process([]).tracked).toBeNull();
      Object.defineProperty(globalThis, 'performance', descriptor);
      jest.advanceTimersByTime(1);
      const returning = session.process([code()]);
      expect(returning.scanned).toEqual([]);
      expect(returning.tracked![0]!.id).toBe('spatial-0:spatial-2');
      expect(returning.tracked![0]!.firstSeen).toBe(BASE + 501);
    } finally {
      Object.defineProperty(globalThis, 'performance', descriptor);
    }
  });
});
