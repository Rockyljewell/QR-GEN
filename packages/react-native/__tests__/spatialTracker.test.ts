// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

import { createBarcode } from '../src/barcode';
import { BarcodeTracker, trackingId, type TrackerOptions } from '../src/tracker';
import type { Barcode, Size } from '../src/types';

const FRAME = { width: 1000, height: 600 };
const code = (x: number, y = 100, data = 'same', width = 40, frameSize: Size = FRAME): Barcode => createBarcode({
  data, symbology: 'qr', timestamp: 9, frameSize: { ...frameSize },
  location: {
    topLeft: { x: x - width / 2, y: y - width / 2 }, topRight: { x: x + width / 2, y: y - width / 2 },
    bottomRight: { x: x + width / 2, y: y + width / 2 }, bottomLeft: { x: x - width / 2, y: y + width / 2 },
  },
});
const spatial = (options: TrackerOptions = {}): BarcodeTracker => new BarcodeTracker({ spatial: true, ...options });
const snapshot = (tracker: BarcodeTracker): unknown => JSON.parse(JSON.stringify(tracker.tracked));

describe('optional spatial tracking', () => {
  it('preserves payload aggregation, FNV identifiers and acceptance of unknown geometry by default', () => {
    const tracker = new BarcodeTracker();
    expect([tracker.spatial, tracker.maxJump, tracker.maxAssociationWork]).toEqual([false, 3, 250_000]);
    const unknown = createBarcode({ data: 'same', symbology: 'qr' });
    const first = tracker.update([unknown, unknown], 0, { width: 0, height: 0 });
    expect(first.tracked).toHaveLength(1);
    expect(first.added[0]!.id).toBe(trackingId('qr', 'same'));
    expect(tracker.update([unknown, unknown], 1).tracked[0]!.count).toBe(2);
    tracker.reset();
    expect(tracker.update([unknown], 2).tracked[0]!.id).toBe(first.added[0]!.id);
  });

  it('keeps separate observations for equal payloads and counts each once per decoded frame', () => {
    const tracker = spatial();
    const first = tracker.update([code(100), code(500)], 0);
    expect(first.added.map(b => b.id)).toEqual(['spatial-1', 'spatial-2']);
    expect(first.tracked.map(b => b.count)).toEqual([1, 1]);
    const repeated = tracker.update([code(501), code(101)], 100);
    expect(repeated.added).toEqual([]);
    expect(repeated.removed).toEqual([]);
    expect(repeated.tracked.map(b => [b.id, b.count, b.firstSeen, b.lastSeen])).toEqual([
      ['spatial-1', 2, 0, 100], ['spatial-2', 2, 0, 100],
    ]);
  });

  it.each([false, true])('maximizes one-to-one matches instead of taking the nearest greedy pair (reverse=%s)', reverse => {
    const tracker = spatial();
    const first = tracker.update([code(0), code(100)], 0);
    const detections = [code(80), code(210)];
    const update = tracker.update(reverse ? detections.reverse() : detections, 1);
    expect(update.added).toEqual([]);
    expect(update.tracked.map(b => [b.id, b.location.topLeft.x + 20])).toEqual([
      [first.tracked[0]!.id, 80], [first.tracked[1]!.id, 210],
    ]);
  });

  it('minimizes total Euclidean movement after maximizing cardinality', () => {
    const tracker = spatial({ maxJump: 100 });
    tracker.update([code(0, 0), code(100, 100)], 0);
    const update = tracker.update([code(80, 100), code(20, 0)], 1);
    expect(update.tracked.map(b => [b.id, b.location.topLeft.x + 20])).toEqual([['spatial-1', 20], ['spatial-2', 80]]);
  });

  it('uses numeric creation order for equal-distance ties after the tenth ID', () => {
    const tracker = spatial();
    tracker.update(Array.from({ length: 12 }, () => code(100)), 0);
    const update = tracker.update([code(100)], 1);
    expect(update.tracked.filter(b => b.lastSeen === 1).map(b => b.id)).toEqual(['spatial-1']);
    expect(update.tracked.map(b => b.id)).toEqual(Array.from({ length: 12 }, (_, i) => `spatial-${i + 1}`));
  });

  it('keeps exact symbology/data pairs separate, including NUL delimiters and hash collisions', () => {
    const tracker = spatial();
    const a = { ...code(0, 0, 'b\u0000c'), symbology: 'a' as Barcode['symbology'] };
    const b = { ...code(0, 0, 'c'), symbology: 'a\u0000b' as Barcode['symbology'] };
    const first = tracker.update([a, b, code(300, 100, 'costarring'), code(300, 100, 'liquid')], 0);
    expect(trackingId('qr', 'costarring')).toBe(trackingId('qr', 'liquid'));
    expect(new Set(first.tracked.map(item => item.id)).size).toBe(4);
    const repeated = tracker.update([b, a, code(300, 100, 'liquid'), code(300, 100, 'costarring')], 1);
    expect(repeated.added).toEqual([]);
    expect(repeated.tracked.map(item => [item.id, item.data, item.symbology, item.count]))
      .toEqual(first.tracked.map(item => [item.id, item.data, item.symbology, 2]));
  });

  it('accepts arbitrary JavaScript string code units without hashing them for identity', () => {
    const tracker = spatial();
    const text = code(0, 0, '\ud800\u0000\udfff');
    expect(tracker.update([text], 0).tracked[0]!.data).toBe(text.data);
    expect(tracker.update([text], 1).tracked[0]!.id).toBe('spatial-1');
  });

  it('uses the detection extent for the movement gate and supports zero jump and line geometry', () => {
    const tracker = spatial({ maxJump: 0 });
    const line = code(100);
    line.location.bottomLeft.y = line.location.topLeft.y;
    line.location.bottomRight.y = line.location.topRight.y;
    tracker.update([line], 0);
    expect(tracker.update([line], 1).added).toEqual([]);
    expect(tracker.update([code(100.1, 80)], 2).added).toHaveLength(1);
    const other = spatial({ maxJump: 1 });
    other.update([code(0, 0, 'same', 200)], 0);
    expect(other.update([code(30, 0, 'same', 20)], 1).added).toHaveLength(1);
  });

  it('preserves the exact timeout boundary and creates fresh IDs after expiry and reset', () => {
    const tracker = spatial();
    const first = tracker.update([code(100)], 0).tracked[0]!;
    expect(tracker.prune(500).removed).toEqual([]);
    expect(tracker.update([], 500).changed).toBe(false);
    const returning = tracker.update([code(100)], 501);
    expect(returning.removed).toEqual([first]);
    expect(returning.added[0]!.id).toBe('spatial-2');
    expect(returning.added[0]!.count).toBe(1);
    tracker.reset();
    expect(tracker.size).toBe(0);
    expect(tracker.prune(502)).toEqual({ tracked: [], added: [], removed: [], changed: false });
    expect(tracker.update([code(100)], 503).added[0]!.id).toBe('spatial-3');
  });

  it('retains a temporarily unseen track and expires it through prune once', () => {
    const tracker = spatial();
    const old = tracker.update([code(100), code(500)], 0).tracked;
    const blank = tracker.update([], 100);
    expect(blank.tracked).toEqual(old);
    expect(blank.changed).toBe(false);
    expect(tracker.update([code(101)], 300).tracked.map(b => b.count)).toEqual([2, 1]);
    expect(tracker.prune(501).removed.map(b => b.id)).toEqual(['spatial-2']);
    expect(tracker.prune(502).removed).toEqual([]);
  });

  it.each([false, true])('resets coordinate space on a changed frame size, including blank frames (blank=%s)', blank => {
    const tracker = spatial();
    const old = tracker.update([code(100)], 0).tracked;
    const resized = { width: 800, height: 600 };
    const update = tracker.update(blank ? [] : [code(100, 100, 'same', 40, resized)], 1, resized);
    expect(update.removed).toEqual(old);
    if (blank) expect(update.tracked).toEqual([]);
    const next = tracker.update([code(100, 100, 'same', 40, resized)], 2, resized);
    expect(next.removed).toEqual([]);
    expect(next.tracked[0]!.id).toBe('spatial-2');
    expect(next.tracked[0]!.count).toBe(blank ? 1 : 2);
  });

  it('refreshes every barcode metadata field without changing firstSeen or track order', () => {
    const tracker = spatial();
    tracker.update([code(100), code(500)], 10);
    const latest = { ...code(102), timestamp: 99, rawBytes: 'YWJj', isGS1: true, contentType: 'gs1' as const,
      orientation: 90, ecLevel: 'H', symbologyIdentifier: ']Q3', symbologyName: 'Latest' };
    const update = tracker.update([latest], 11);
    expect(update.tracked[0]).toEqual({ ...latest, id: 'spatial-1', firstSeen: 10, lastSeen: 11, count: 2 });
    expect(update.tracked[1]!.id).toBe('spatial-2');
  });

  it('snapshots input geometry so later caller edits do not change retained coordinates', () => {
    const tracker = spatial();
    const input = code(100);
    tracker.update([input], 0);
    input.location.topLeft.x = 800;
    input.frameSize.width = 20;
    expect(tracker.tracked[0]!.location.topLeft.x).toBe(80);
    expect(tracker.tracked[0]!.frameSize.width).toBe(1000);
  });

  it('handles finite extreme centers without overflowing the intermediate sum', () => {
    const tracker = spatial({ maxJump: 0 });
    const huge = code(0);
    huge.location = {
      topLeft: { x: 1e308, y: 0 }, topRight: { x: 1e308, y: 2 },
      bottomRight: { x: 1e308, y: 3 }, bottomLeft: { x: 1e308, y: 1 },
    };
    expect(tracker.update([huge], 0).added).toHaveLength(1);
    expect(tracker.update([huge], 1).added).toEqual([]);
  });
});

describe('spatial validation and transaction boundaries', () => {
  it.each([NaN, Infinity, -Infinity, -1, null, true, '3'])('rejects invalid maxJump %p', value => {
    expect(() => spatial({ maxJump: value as number })).toThrow();
  });
  it.each([0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, null, true, '1'])('rejects invalid work policy %p', value => {
    expect(() => spatial({ maxAssociationWork: value as number })).toThrow();
  });
  it.each([null, 0, 'true'])('rejects non-boolean spatial policy %p', value => {
    expect(() => new BarcodeTracker({ spatial: value as unknown as boolean })).toThrow();
  });
  it('exposes construction-only policies through getters', () => {
    const tracker = spatial({ maxJump: 2, maxAssociationWork: 123 });
    for (const [key, value] of [['spatial', false], ['maxJump', 100], ['maxAssociationWork', 1]] as const) {
      expect(Reflect.set(tracker, key, value)).toBe(false);
    }
    expect([tracker.spatial, tracker.maxJump, tracker.maxAssociationWork]).toEqual([true, 2, 123]);
  });
  it.each([NaN, Infinity, -Infinity, null, '1', true])('rejects invalid spatial clock %p before expiry', value => {
    const tracker = spatial();
    tracker.update([code(100)], 0);
    const before = snapshot(tracker);
    expect(() => tracker.update([code(100)], value as number)).toThrow();
    expect(() => tracker.prune(value as number)).toThrow();
    expect(snapshot(tracker)).toEqual(before);
  });
  it.each([0, -1, 1.5, NaN, Infinity, true, '600', Number.MAX_SAFE_INTEGER + 1])('rejects invalid dimensions %p without consuming state', value => {
    const tracker = spatial();
    tracker.update([code(100)], 0);
    const before = snapshot(tracker);
    const bad = code(200, 100, 'same', 40, { width: value as number, height: 600 });
    expect(() => tracker.update([code(300), bad], 501)).toThrow();
    expect(snapshot(tracker)).toEqual(before);
    expect(() => tracker.update([], 501, { width: 1000, height: value as number })).toThrow();
    expect(snapshot(tracker)).toEqual(before);
    expect(tracker.update([code(100), code(500)], 1).added[0]!.id).toBe('spatial-2');
  });
  it.each([NaN, Infinity, -Infinity, true, '20'])('rejects malformed or nonfinite point coordinates %p atomically', value => {
    const tracker = spatial();
    tracker.update([code(100)], 0);
    const before = snapshot(tracker);
    const bad = code(500);
    bad.location.topLeft.x = value as number;
    expect(() => tracker.update([code(200), bad], 501)).toThrow();
    expect(snapshot(tracker)).toEqual(before);
  });
  it('rejects zero, missing and overflowing geometry, and non-string payloads', () => {
    const malformed: Barcode[] = [
      { ...code(100), location: undefined as unknown as Barcode['location'] },
      code(100, 100, 'same', 0),
      { ...code(100), data: null as unknown as string },
      { ...code(100), symbology: 42 as unknown as Barcode['symbology'] },
      { ...code(100), frameSize: undefined as unknown as Size },
    ];
    const overflow = code(100);
    overflow.location.topLeft.x = -Number.MAX_VALUE;
    overflow.location.topRight.x = Number.MAX_VALUE;
    malformed.push(overflow);
    for (const bad of malformed) {
      const tracker = spatial();
      tracker.update([code(100)], 0);
      const before = snapshot(tracker);
      expect(() => tracker.update([code(200), bad], 501)).toThrow();
      expect(snapshot(tracker)).toEqual(before);
    }
    expect(() => spatial({ maxJump: Number.MAX_VALUE }).update([code(100)], 0)).toThrow();
  });
  it('requires consistent per-record and explicit source dimensions', () => {
    const tracker = spatial();
    tracker.update([code(100)], 0);
    const before = snapshot(tracker);
    expect(() => tracker.update([code(100), code(500, 100, 'same', 40, { width: 800, height: 600 })], 501)).toThrow();
    expect(() => tracker.update([code(100)], 501, { width: 800, height: 600 })).toThrow();
    expect(snapshot(tracker)).toEqual(before);
  });
  it('reads getter-backed fields once and rejects late metadata and iterable failures before expiry or ID allocation', () => {
    const tracker = spatial();
    tracker.update([code(100)], 0);
    const before = snapshot(tracker);
    const bad = code(500);
    Object.defineProperty(bad, 'symbologyName', { enumerable: true, get() { throw new Error('late metadata'); } });
    expect(() => tracker.update([code(300), bad], 501)).toThrow('late metadata');
    const raising = { *[Symbol.iterator]() { yield code(300); throw new Error('late iterator'); } };
    expect(() => tracker.update(raising as unknown as readonly Barcode[], 501)).toThrow('late iterator');
    expect(snapshot(tracker)).toEqual(before);
    const input = code(100);
    const data = jest.fn(() => 'same');
    Object.defineProperty(input, 'data', { enumerable: true, get: data });
    const width = jest.fn(() => 1000);
    const size = { get width() { return width(); }, height: 600 };
    expect(tracker.update([input, code(500)], 1, size).added[0]!.id).toBe('spatial-2');
    expect(data).toHaveBeenCalledTimes(1);
    expect(width).toHaveBeenCalledTimes(1);
  });
  it('validates caller-mutated retained geometry and dimensions before expiry', () => {
    const tracker = spatial();
    tracker.update([code(100)], 0);
    tracker.tracked[0]!.location.topLeft.x = NaN;
    expect(() => tracker.update([code(300)], 501)).toThrow();
    expect(tracker.size).toBe(1);
    tracker.tracked[0]!.location.topLeft.x = 80;
    tracker.tracked[0]!.frameSize.width = 800;
    expect(() => tracker.prune(501)).toThrow();
    expect(tracker.size).toBe(1);
    tracker.reset();
    expect(tracker.update([code(100)], 502).added[0]!.id).toBe('spatial-2');
  });
  it('plans all output before committing a late observation-count overflow', () => {
    const tracker = spatial();
    tracker.update([code(100)], 0);
    tracker.tracked[0]!.count = Number.MAX_SAFE_INTEGER;
    const before = snapshot(tracker);
    expect(() => tracker.update([code(500, 100, 'new'), code(100)], 1)).toThrow('count');
    expect(snapshot(tracker)).toEqual(before);
    tracker.tracked[0]!.count = 1;
    expect(tracker.update([code(500, 100, 'new'), code(100)], 2).added[0]!.id).toBe('spatial-2');
  });
});

describe('conservative whole-frame spatial work budget', () => {
  it('accepts the exact work boundary and rejects one less without consuming expiry or IDs', () => {
    const accepted = spatial({ maxAssociationWork: 16 });
    accepted.update([code(100), code(500)], 0);
    expect(accepted.update([code(101), code(501)], 1).added).toEqual([]);
    const rejected = spatial({ timeout: 100, maxAssociationWork: 15 });
    rejected.update([code(800, 100, 'old')], -100);
    rejected.update([code(100), code(500)], 0);
    const before = snapshot(rejected);
    expect(() => rejected.update([code(101), code(501)], 1)).toThrow('work 16');
    expect(snapshot(rejected)).toEqual(before);
    const recovery = rejected.update([code(101), code(800, 100, 'new')], 2);
    expect(recovery.removed.map(b => b.data)).toEqual(['old']);
    expect(recovery.added[0]!.id).toBe('spatial-4');
  });
  it('sums work across exact-payload groups rather than applying the budget to each independently', () => {
    const codes = [code(100), code(500), code(100, 300, 'other'), code(500, 300, 'other')];
    const accepted = spatial({ maxAssociationWork: 32 });
    accepted.update(codes, 0);
    expect(accepted.update(codes, 1).added).toEqual([]);
    const rejected = spatial({ maxAssociationWork: 31 });
    rejected.update(codes, 0);
    const before = snapshot(rejected);
    expect(() => rejected.update(codes, 1)).toThrow('work 32');
    expect(snapshot(rejected)).toEqual(before);
  });
  it('charges out-of-gate prior columns conservatively', () => {
    const tracker = spatial({ maxAssociationWork: 1 });
    tracker.update([code(0)], 0);
    expect(() => tracker.update([code(900)], 1)).toThrow('work 2');
    expect(tracker.tracked[0]!.lastSeen).toBe(0);
  });
  it('skips new-only groups and excludes expired history and resized coordinate spaces', () => {
    const tracker = spatial({ maxAssociationWork: 1 });
    const dense = Array.from({ length: 255 }, () => code(100));
    const initial = tracker.update(dense, 0);
    expect(initial.added).toHaveLength(255);
    const before = snapshot(tracker);
    expect(() => tracker.update(dense, 1)).toThrow('work');
    expect(snapshot(tracker)).toEqual(before);
    const expired = tracker.update(dense, 501);
    expect(expired.removed).toHaveLength(255);
    expect(expired.added).toHaveLength(255);
    expect(expired.added[0]!.id).toBe('spatial-256');
    const resized = { width: 800, height: 600 };
    const blank = tracker.update([], 502, resized);
    expect(blank.removed).toHaveLength(255);
    expect(tracker.update(dense.map(b => ({ ...b, frameSize: resized })), 503).added).toHaveLength(255);
  });
  it('permits an explicit larger workload without truncation or a greedy fallback', () => {
    const tracker = spatial({ maxAssociationWork: 50_000_000 });
    const frame = { width: 200_000, height: 1000 };
    const first = Array.from({ length: 255 }, (_, i) => code(i * 100, 100, 'same', 20, frame));
    const backlog = first.map(b => ({ ...b, location: {
      topLeft: { x: b.location.topLeft.x + 100_000, y: 90 }, topRight: { x: b.location.topRight.x + 100_000, y: 90 },
      bottomRight: { x: b.location.bottomRight.x + 100_000, y: 110 }, bottomLeft: { x: b.location.bottomLeft.x + 100_000, y: 110 },
    } }));
    const ids = tracker.update(first, 0).tracked.map(b => b.id);
    expect(tracker.update(backlog, 100).added).toHaveLength(255);
    const moved = first.map((_, i) => code(i * 100 + 1, 100, 'same', 20, frame));
    const update = tracker.update(moved, 200);
    expect(update.added).toEqual([]);
    expect(update.tracked).toHaveLength(510);
    expect(update.tracked.filter(b => b.lastSeen === 200).map(b => b.id)).toEqual(ids);
    expect(update.tracked.slice(0, 255).every(b => b.count === 2)).toBe(true);
  });
});

describe('independent exhaustive assignment oracle', () => {
  it('matches the best cardinality and Euclidean movement in 200 seeded small scenes', () => {
    let seed = 0x524e;
    const random = (limit: number): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed % limit;
    };
    interface Dot { x: number; y: number; width: number }
    const dot = (): Dot => ({ x: random(301), y: random(301), width: 1 + random(80) });
    for (let scene = 0; scene < 200; scene++) {
      const old = Array.from({ length: random(5) }, dot);
      const current = Array.from({ length: random(5) }, dot);
      const jump = [0, 0.5, 1.5, 3][random(4)]!;
      let bestCount = -1, bestDistance = Infinity;
      // Enumerate partial injections directly: no matrix, normalization, Hungarian
      // potentials or tie-breaking implementation from the production algorithm.
      const enumerate = (row: number, used: Set<number>, count: number, distance: number): void => {
        if (row === current.length) {
          if (count > bestCount || (count === bestCount && distance < bestDistance)) {
            bestCount = count;
            bestDistance = distance;
          }
          return;
        }
        enumerate(row + 1, used, count, distance);
        const detection = current[row]!;
        for (let column = 0; column < old.length; column++) if (!used.has(column)) {
          const prior = old[column]!;
          const movement = Math.hypot(prior.x - detection.x, prior.y - detection.y);
          if (movement <= Math.max(detection.width, 1) * jump) {
            used.add(column);
            enumerate(row + 1, used, count + 1, distance + movement);
            used.delete(column);
          }
        }
      };
      enumerate(0, new Set(), 0, 0);
      const tracker = spatial({ maxJump: jump });
      const ids = tracker.update(old.map(p => code(p.x, p.y, 'same', p.width)), 0).tracked.map(b => b.id);
      const update = tracker.update(current.map((p, index) => ({ ...code(p.x, p.y, 'same', p.width), rawBytes: String(index) })), 1);
      const observed = update.tracked.filter(b => b.lastSeen === 1);
      const matches = observed.filter(b => ids.includes(b.id));
      expect(matches).toHaveLength(bestCount);
      expect(update.added).toHaveLength(current.length - bestCount);
      let actualDistance = 0;
      const used = new Set<string>();
      for (const match of matches) {
        expect(used.has(match.id)).toBe(false);
        used.add(match.id);
        const a = old[ids.indexOf(match.id)]!, b = current[Number(match.rawBytes)]!;
        const movement = Math.hypot(a.x - b.x, a.y - b.y);
        expect(movement).toBeLessThanOrEqual(Math.max(b.width, 1) * jump);
        actualDistance += movement;
      }
      expect(actualDistance).toBeCloseTo(bestDistance, 8);
    }
  });
});

describe('spatial duration clocks and atomic source transitions', () => {
  const BASE = 1_800_000_000_000;
  const state = (tracker: BarcodeTracker): string => JSON.stringify(tracker, (_, item: unknown) =>
    item instanceof Map ? [...item] : item instanceof Set ? [...item] : item);
  const move = (elapsed: number, step = 0): void => {
    jest.advanceTimersByTime(elapsed);
    jest.setSystemTime(BASE + elapsed + step);
  };
  const scenarios = [
    { name: 'rollback after elapsed expiry', elapsed: 2000, step: -60_000, expired: true },
    { name: 'forward jump before elapsed expiry', elapsed: 100, step: 60_000, expired: false },
  ];
  beforeEach(() => jest.useFakeTimers({ now: BASE }));
  afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });

  it.each(scenarios)('prune uses elapsed time despite $name', ({ elapsed, step, expired }) => {
    const tracker = spatial();
    const old = tracker.update([code(100)]).tracked;
    move(elapsed, step);
    const update = tracker.prune();
    expect(update.removed).toEqual(expired ? old : []);
    expect(update.tracked).toEqual(expired ? [] : old);
  });

  it.each(scenarios)('update uses elapsed expiry and epoch metadata despite $name', ({ elapsed, step, expired }) => {
    const tracker = spatial();
    const old = tracker.update([code(100)]).tracked;
    move(elapsed, step);
    const update = tracker.update([code(101)]);
    expect(update.removed).toEqual(expired ? old : []);
    expect(update.tracked[0]!.id).toBe(expired ? 'spatial-2' : 'spatial-1');
    expect(update.tracked[0]!.count).toBe(expired ? 1 : 2);
    expect(update.tracked[0]!.firstSeen).toBe(expired ? Date.now() : BASE);
    expect(update.tracked[0]!.lastSeen).toBe(BASE + elapsed + step);
    expect(update.tracked[0]!.timestamp).toBe(9);
  });

  it('keeps exact default elapsed boundaries and drops released history once', () => {
    const tracker = spatial();
    const old = tracker.update([code(100)]).tracked;
    jest.advanceTimersByTime(500);
    expect(tracker.prune().tracked).toEqual(old);
    jest.advanceTimersByTime(1);
    expect(tracker.prune().removed).toEqual(old);
    expect(tracker.prune().removed).toEqual([]);
    expect((tracker as unknown as { lastObserved: Map<string, number> }).lastObserved.size).toBe(0);
    expect(tracker.update([code(100)]).added[0]!.id).toBe('spatial-2');
  });

  it('keeps injected times independent of system time and monotonic progression', () => {
    const tracker = spatial();
    const old = tracker.update([code(100)], 0).tracked;
    move(2000, -60_000);
    expect(tracker.prune(500).tracked).toEqual(old);
    expect(tracker.prune(501).removed).toEqual(old);
    const returning = tracker.update([code(100)], 502).tracked[0]!;
    expect([returning.id, returning.firstSeen, returning.lastSeen]).toEqual(['spatial-2', 502, 502]);
  });

  it('rebases default/explicit/default transitions from retained epoch age', () => {
    const tracker = spatial();
    const old = tracker.update([code(100)]).tracked;
    move(500);
    expect(tracker.prune(BASE + 500).tracked).toEqual(old);
    jest.advanceTimersByTime(1);
    expect(tracker.prune().removed).toEqual(old);
    expect(tracker.update([code(100)], BASE + 502).added[0]!.id).toBe('spatial-2');
    jest.advanceTimersByTime(100);
    const next = tracker.update([code(101)]).tracked[0]!;
    expect([next.id, next.count, next.firstSeen, next.lastSeen]).toEqual(['spatial-2', 2, BASE + 502, BASE + 601]);
  });

  it('preserves the legacy timestamp-age contract when an injected origin is intentionally zero-based', () => {
    const tracker = spatial();
    const old = tracker.update([code(100)]).tracked;
    expect(tracker.prune(0).tracked).toEqual(old);
    expect(tracker.prune().tracked).toEqual(old);
    tracker.reset();
    const explicit = tracker.update([code(100)], 0).tracked;
    expect(tracker.prune().removed).toEqual(explicit);
  });

  it('uses monotonic durations after rebasing even when wall time subsequently rolls back', () => {
    const tracker = spatial();
    const old = tracker.update([code(100)], BASE).tracked;
    move(500);
    expect(tracker.prune().tracked).toEqual(old);
    jest.advanceTimersByTime(1);
    jest.setSystemTime(BASE - 60_000);
    expect(tracker.prune().removed).toEqual(old);
  });

  it('does not consume a default-source transition or expiry after a late metadata getter failure', () => {
    const tracker = spatial();
    const old = tracker.update([code(100)], BASE).tracked;
    move(2000);
    const before = state(tracker);
    const bad = code(500);
    Object.defineProperty(bad, 'symbologyName', { enumerable: true, get() { throw new Error('late metadata'); } });
    expect(() => tracker.update([code(200), bad])).toThrow('late metadata');
    expect(state(tracker)).toBe(before);
    const recovered = tracker.update([code(200)]);
    expect(recovered.removed).toEqual(old);
    expect(recovered.added[0]!.id).toBe('spatial-2');
    expect(recovered.added[0]!.firstSeen).toBe(BASE + 2000);
  });

  it('does not consume a source transition, elapsed rebase or planned ID after late count overflow', () => {
    const tracker = spatial();
    tracker.update([code(100)], BASE);
    tracker.tracked[0]!.count = Number.MAX_SAFE_INTEGER;
    move(100);
    const before = state(tracker);
    expect(() => tracker.update([code(500, 100, 'new'), code(100)])).toThrow('count');
    expect(state(tracker)).toBe(before);
    tracker.tracked[0]!.count = 1;
    const recovered = tracker.update([code(500, 100, 'new'), code(100)]);
    expect(recovered.added[0]!.id).toBe('spatial-2');
    expect(recovered.tracked[0]!.count).toBe(2);
    expect(recovered.tracked[0]!.lastSeen).toBe(BASE + 100);
  });

  it('does not consume a source transition or elapsed history when association exceeds the budget', () => {
    const tracker = spatial({ maxAssociationWork: 15 });
    const old = tracker.update([code(100), code(500)], BASE).tracked;
    move(1);
    const before = state(tracker);
    expect(() => tracker.update([code(101), code(501)])).toThrow('work 16');
    expect(state(tracker)).toBe(before);
    expect(tracker.prune(BASE + 500).tracked).toEqual(old);
    jest.advanceTimersByTime(500);
    expect(tracker.prune().removed).toEqual(old);
    expect(tracker.update([code(100)]).added[0]!.id).toBe('spatial-3');
  });

  it.each([NaN, Infinity, -Infinity])('rejects nonfinite default epoch clock %p without consuming state', value => {
    const tracker = spatial();
    tracker.update([code(100)], BASE);
    const before = state(tracker);
    jest.spyOn(Date, 'now').mockReturnValue(value);
    expect(() => tracker.update([code(200)])).toThrow('clock');
    expect(() => tracker.prune()).toThrow('clock');
    expect(state(tracker)).toBe(before);
  });

  it.each([NaN, Infinity, -Infinity])('rejects nonfinite default elapsed clock %p without consuming state', value => {
    const tracker = spatial();
    tracker.update([code(100)], BASE);
    const before = state(tracker);
    jest.spyOn((globalThis as typeof globalThis & { performance: { now(): number } }).performance, 'now').mockReturnValue(value);
    expect(() => tracker.update([code(200)])).toThrow('clock');
    expect(() => tracker.prune()).toThrow('clock');
    expect(state(tracker)).toBe(before);
  });

  it('rejects an overflowing elapsed rebase atomically despite finite input clocks', () => {
    const tracker = spatial();
    tracker.update([code(100)], Number.MAX_VALUE);
    const before = state(tracker);
    jest.spyOn(Date, 'now').mockReturnValue(-Number.MAX_VALUE);
    expect(() => tracker.prune()).toThrow('elapsed history');
    expect(state(tracker)).toBe(before);
    expect(tracker.update([code(100)], Number.MAX_VALUE).tracked[0]!.count).toBe(2);
  });

  it('rebases unsupported wall fallback and restored monotonic sources by timestamp age', () => {
    const tracker = spatial();
    const old = tracker.update([code(100)], BASE).tracked;
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'performance')!;
    try {
      Object.defineProperty(globalThis, 'performance', { value: undefined, configurable: true });
      move(500);
      expect(tracker.prune().tracked).toEqual(old);
      Object.defineProperty(globalThis, 'performance', descriptor);
      expect(tracker.prune().tracked).toEqual(old);
      jest.advanceTimersByTime(1);
      expect(tracker.prune().removed).toEqual(old);
    } finally {
      Object.defineProperty(globalThis, 'performance', descriptor);
    }
  });

  it('reset forgets elapsed history and clock source while preserving fresh spatial IDs', () => {
    const tracker = spatial();
    tracker.update([code(100)], BASE);
    tracker.reset();
    const internal = tracker as unknown as { lastObserved: Map<string, number>; clock: { source?: string } };
    expect(internal.lastObserved.size).toBe(0);
    expect(internal.clock.source).toBeUndefined();
    expect(tracker.update([code(100)]).added[0]!.id).toBe('spatial-2');
    expect(internal.clock.source).toBe('monotonic');
  });

  it('blank coordinate resets release elapsed history and preserve clock policy and fresh IDs', () => {
    const tracker = spatial();
    tracker.update([code(100), code(500)]);
    move(100);
    const size = { width: 800, height: 600 };
    expect(tracker.update([], undefined, size).removed).toHaveLength(2);
    const internal = tracker as unknown as { lastObserved: Map<string, number>; clock: { source?: string } };
    expect(internal.lastObserved.size).toBe(0);
    expect(internal.clock.source).toBe('monotonic');
    expect(tracker.update([code(100, 100, 'same', 40, size)]).added[0]!.id).toBe('spatial-3');
  });
});
