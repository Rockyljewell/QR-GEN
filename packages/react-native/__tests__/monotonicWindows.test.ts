// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

import { createBarcode } from '../src/barcode';
import { DuplicateFilter } from '../src/duplicateFilter';
import { ScanSession } from '../src/session';
import { BarcodeTracker } from '../src/tracker';
import { DurationClock } from '../src/durationClock';

const BASE = 1_800_000_000_000;
const barcode = (data = 'clock') => createBarcode({ data, symbology: 'qr' });
const scenarios = [
  { name: 'rollback after elapsed expiry', elapsed: 2000, step: -60_000, expired: true, report: true },
  { name: 'forward jump before elapsed expiry', elapsed: 100, step: 60_000, expired: false, report: false },
];

beforeEach(() => jest.useFakeTimers({ now: BASE }));
afterEach(() => jest.useRealTimers());

function move(elapsed: number, step = 0): void {
  jest.advanceTimersByTime(elapsed);
  jest.setSystemTime(BASE + elapsed + step);
  expect((globalThis as typeof globalThis & { performance: { now(): number } }).performance.now()).toBe(elapsed);
}

describe('default duration windows survive independent wall-clock changes', () => {
  it.each(scenarios)('DuplicateFilter.accept: $name', ({ elapsed, step, report }) => {
    const filter = new DuplicateFilter(1000);
    expect(filter.accept(barcode())).toBe(true);
    move(elapsed, step);
    expect(filter.accept(barcode())).toBe(report);
  });

  it.each(scenarios)('DuplicateFilter.filter: $name', ({ elapsed, step, report }) => {
    const filter = new DuplicateFilter(1000);
    expect(filter.filter([barcode(), barcode()])).toHaveLength(1);
    move(elapsed, step);
    expect(filter.filter([barcode(), barcode()])).toHaveLength(report ? 1 : 0);
  });

  it.each(scenarios)('BarcodeTracker.prune: $name', ({ elapsed, step, expired }) => {
    const tracker = new BarcodeTracker({ timeout: 500 });
    const first = tracker.update([barcode()]).tracked[0]!;
    move(elapsed, step);
    const result = tracker.prune();
    expect(result.tracked).toEqual(expired ? [] : [first]);
    expect(result.removed).toEqual(expired ? [first] : []);
  });

  it.each(scenarios)('BarcodeTracker.update: $name', ({ elapsed, step, expired }) => {
    const tracker = new BarcodeTracker({ timeout: 500 });
    const first = tracker.update([barcode()]).tracked[0]!;
    move(elapsed, step);
    const result = tracker.update([barcode(), barcode()]);
    expect(result.removed).toEqual(expired ? [first] : []);
    expect(result.tracked).toHaveLength(1);
    expect(result.tracked[0]!.count).toBe(expired ? 1 : 2);
    expect(result.tracked[0]!.firstSeen).toBe(expired ? Date.now() : BASE);
    expect(result.tracked[0]!.lastSeen).toBe(BASE + elapsed + step);
    expect(result.tracked[0]!.timestamp).toBe(BASE + elapsed + step);
  });

  it.each(scenarios)('ScanSession continuous process: $name', ({ elapsed, step, report }) => {
    const session = new ScanSession({ mode: 'continuous', duplicateFilter: 1000 });
    expect(session.process([barcode()]).scanned).toHaveLength(1);
    move(elapsed, step);
    expect(session.process([barcode()]).scanned).toHaveLength(report ? 1 : 0);
  });

  it.each(scenarios)('ScanSession batch tick: $name', ({ elapsed, step, expired }) => {
    const session = new ScanSession({ mode: 'batch', trackingTimeout: 500 });
    const first = session.process([barcode()]).tracked![0]!;
    move(elapsed, step);
    expect(session.tick()).toEqual(expired ? [] : null);
    expect(session.tracked).toEqual(expired ? [] : [first]);
  });

  it.each(scenarios)('ScanSession batch process: $name', ({ elapsed, step, expired, report }) => {
    const session = new ScanSession({ mode: 'batch', duplicateFilter: 1000, trackingTimeout: 500 });
    session.process([barcode()]);
    move(elapsed, step);
    const result = session.process([barcode(), barcode()]);
    expect(result.scanned).toHaveLength(report ? 1 : 0);
    expect(result.tracked![0]!.count).toBe(expired ? 1 : 2);
    expect(result.tracked![0]!.lastSeen).toBe(BASE + elapsed + step);
  });
});

describe('clock planning, source changes and retained-history cleanup', () => {
  const state = (value: object) => JSON.stringify(value, (_, item: unknown) =>
    item instanceof Map ? [...item] : item instanceof Set ? [...item] : item);

  it('preview does not consume a transition and reset forgets its source', () => {
    const clock = new DurationClock();
    const explicit = clock.preview(0);
    expect(explicit).toMatchObject({ timestamp: 0, elapsed: 0, source: 'explicit', changed: false });
    expect(clock.preview().changed).toBe(false);
    clock.commit(explicit);
    expect(clock.preview().changed).toBe(true);
    expect(clock.preview(1).changed).toBe(false);
    clock.commit(clock.preview());
    expect(clock.preview(1).changed).toBe(true);
    clock.reset();
    expect(clock.preview(1).changed).toBe(false);
  });

  it('fallback pure-JS wall time and restored monotonic time rebase timestamp age', () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'performance')!;
    const filter = new DuplicateFilter(1000);
    const tracker = new BarcodeTracker({ timeout: 500 });
    try {
      Object.defineProperty(globalThis, 'performance', { value: undefined, configurable: true });
      expect(filter.accept(barcode())).toBe(true);
      const first = tracker.update([barcode()]).tracked[0]!;
      jest.advanceTimersByTime(500);
      expect(filter.accept(barcode())).toBe(false);
      expect(tracker.prune().tracked).toEqual([first]);
      Object.defineProperty(globalThis, 'performance', descriptor);
      expect(filter.accept(barcode())).toBe(false);
      expect(tracker.prune().tracked).toEqual([first]);
      jest.advanceTimersByTime(1);
      expect(tracker.prune().tracked).toEqual([]);
      jest.advanceTimersByTime(499);
      expect(filter.accept(barcode())).toBe(true);
    } finally {
      Object.defineProperty(globalThis, 'performance', descriptor);
    }
  });

  it('a failed tracker frame cannot consume expiry, IDs or a clock-source transition', () => {
    const tracker = new BarcodeTracker({ timeout: 500 });
    tracker.update([barcode()], BASE);
    move(2000);
    const before = state(tracker);
    const bad = { ...barcode('bad'), get data(): string { throw new Error('record failed'); } };
    expect(() => tracker.update([barcode('new'), bad])).toThrow('record failed');
    expect(state(tracker)).toBe(before);
    const accepted = tracker.update([barcode('new')]);
    expect(accepted.removed).toHaveLength(1);
    expect(accepted.added).toHaveLength(1);
    expect(accepted.tracked[0]!.count).toBe(1);
    expect(accepted.tracked[0]!.firstSeen).toBe(BASE + 2000);
  });

  it('a failed filter frame cannot consume an unseen report or clock transition', () => {
    const filter = new DuplicateFilter(1000);
    expect(filter.accept(barcode(), BASE)).toBe(true);
    move(2000);
    const before = state(filter);
    const bad = { symbology: 'qr', get data(): string { throw new Error('record failed'); } };
    expect(() => filter.filter([barcode('unseen'), bad])).toThrow('record failed');
    expect(state(filter)).toBe(before);
    expect(filter.filter([barcode('unseen'), barcode()])).toHaveLength(2);
  });

  it('cleanup and reset release both epoch and elapsed filter histories', () => {
    const filter = new DuplicateFilter(1000);
    filter.filter([barcode('old1'), barcode('old2')]);
    move(2000, -60_000);
    filter.filter(Array.from({ length: 257 }, (_, index) => barcode(`new${index}`)));
    expect(filter.size).toBe(257);
    const internal = filter as unknown as { lastReported: Map<string, number>; lastReportedElapsed: Map<string, number> };
    expect([...internal.lastReported.keys()]).toEqual([...internal.lastReportedElapsed.keys()]);
    expect(internal.lastReported.has('qr\0old1')).toBe(false);
    filter.reset();
    expect(internal.lastReported.size).toBe(0);
    expect(internal.lastReportedElapsed.size).toBe(0);
  });

  it('filter updates a large once-per-session history in place instead of copying it per frame', () => {
    const filter = new DuplicateFilter(-1);
    filter.filter(Array.from({ length: 5000 }, (_, index) => barcode(`seen${index}`)));
    const internal = filter as unknown as { lastReported: Map<string, number>; lastReportedElapsed: Map<string, number> };
    const reported = internal.lastReported, elapsed = internal.lastReportedElapsed;
    move(10);
    expect(filter.filter([barcode('seen1'), barcode('fresh'), barcode('fresh')]).map(code => code.data)).toEqual(['fresh']);
    expect(internal.lastReported).toBe(reported);
    expect(internal.lastReportedElapsed).toBe(elapsed);
    expect(filter.size).toBe(5001);
  });

  it('expiry and reset release tracker elapsed history and preserve hash collision controls', () => {
    const tracker = new BarcodeTracker({ timeout: 500 });
    tracker.update([barcode('costarring'), barcode('liquid')]);
    expect(new Set(tracker.tracked.map(item => item.id)).size).toBe(2);
    move(501, -60_000);
    expect(tracker.prune().removed).toHaveLength(2);
    const internal = tracker as unknown as { lastObserved: Map<string, number> };
    expect(internal.lastObserved.size).toBe(0);
    tracker.update([barcode()]);
    tracker.reset();
    expect(internal.lastObserved.size).toBe(0);
    expect(tracker.update([barcode()], 0).tracked[0]!.firstSeen).toBe(0);
  });
});

describe('duration and epoch controls preserve existing contracts', () => {
  it('keeps normal exact timeout and duplicate boundaries', () => {
    const filter = new DuplicateFilter(1000);
    const tracker = new BarcodeTracker({ timeout: 500 });
    expect(filter.accept(barcode())).toBe(true);
    const first = tracker.update([barcode()]).tracked[0]!;
    jest.advanceTimersByTime(500);
    expect(tracker.prune().tracked).toEqual([first]);
    expect(filter.accept(barcode())).toBe(false);
    jest.advanceTimersByTime(1);
    expect(tracker.prune().tracked).toEqual([]);
    jest.advanceTimersByTime(499);
    expect(filter.accept(barcode())).toBe(true);
  });

  it('keeps epoch metadata on ordinary calls', () => {
    const session = new ScanSession({ mode: 'batch' });
    const first = session.process([barcode()]).tracked![0]!;
    expect(first.firstSeen).toBe(BASE);
    move(100);
    const result = session.process([barcode()]).tracked![0]!;
    expect(result.firstSeen).toBe(BASE);
    expect(result.lastSeen).toBe(BASE + 100);
    expect(result.timestamp).toBe(BASE + 100);
    expect(result.count).toBe(2);
  });

  it('keeps explicit now as the injected clock irrespective of wall time', () => {
    const filter = new DuplicateFilter(1000);
    const tracker = new BarcodeTracker({ timeout: 500 });
    expect(filter.accept(barcode(), 0)).toBe(true);
    const first = tracker.update([barcode()], 0).tracked[0]!;
    move(100, 60_000);
    expect(filter.accept(barcode(), 999)).toBe(false);
    expect(filter.accept(barcode(), 1000)).toBe(true);
    expect(tracker.prune(500).tracked).toEqual([first]);
    expect(tracker.prune(501).tracked).toEqual([]);
  });

  it('preserves retained timestamp age when switching explicit/default clocks', () => {
    const filter = new DuplicateFilter(1000);
    const tracker = new BarcodeTracker({ timeout: 500 });
    expect(filter.accept(barcode())).toBe(true);
    const first = tracker.update([barcode()]).tracked[0]!;
    move(500);
    expect(filter.accept(barcode(), BASE + 500)).toBe(false);
    expect(tracker.prune(BASE + 500).tracked).toEqual([first]);
    jest.advanceTimersByTime(1);
    expect(tracker.prune().tracked).toEqual([]);
    jest.advanceTimersByTime(499);
    expect(filter.accept(barcode())).toBe(true);
  });

  it('retains legacy age behavior for an intentional zero-based injected origin', () => {
    const filter = new DuplicateFilter(1000);
    const tracker = new BarcodeTracker({ timeout: 500 });
    expect(filter.accept(barcode())).toBe(true);
    tracker.update([barcode()]);
    expect(filter.accept(barcode(), 0)).toBe(false);
    expect(tracker.prune(0).tracked).toHaveLength(1);
    expect(filter.accept(barcode(), BASE + 1000)).toBe(true);
    tracker.reset();
    tracker.update([barcode()], 0);
    expect(tracker.prune().tracked).toEqual([]);
  });

  it.each([0, -1])('preserves duplicate special window %s across wall changes', (window) => {
    const filter = new DuplicateFilter(window);
    expect(filter.accept(barcode())).toBe(true);
    move(2000, -60_000);
    expect(filter.accept(barcode())).toBe(window === 0);
    filter.reset();
    expect(filter.accept(barcode())).toBe(true);
  });

  it('reset clears history for both clock sources', () => {
    const session = new ScanSession({ mode: 'batch', duplicateFilter: -1 });
    session.process([barcode()]);
    session.reset();
    expect(session.tracked).toEqual([]);
    expect(session.process([barcode()], 0).scanned).toHaveLength(1);
    session.reset();
    expect(session.process([barcode()]).scanned).toHaveLength(1);
  });

  it('explicit session times preserve paused, single and continuous semantics', () => {
    const session = new ScanSession({ mode: 'single', duplicateFilter: 1000 });
    expect(session.process([barcode()], 0).stop).toBe(true);
    expect(session.process([barcode('other')], 1000).scanned).toEqual([]);
    session.resume();
    expect(session.process([barcode()], 999).scanned).toEqual([]);
    expect(session.process([barcode()], 1000).stop).toBe(true);
    session.configure({ mode: 'continuous' });
    expect(session.process([barcode('other')], 1001).scanned).toHaveLength(1);
  });
});
