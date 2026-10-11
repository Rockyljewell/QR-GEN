// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

import type { EmbedCommand } from '../src/embed';
import { WebScannerTransport } from '../src/webScannerTransport';

type Packet = { source: string; version: number; owner: string; nonce: number; kind: string; id?: number; accepted?: boolean; available?: boolean };
type Page = { qrgen?: { command: (command: EmbedCommand) => void }; ReactNativeWebView: { postMessage: (raw: string) => void } };

function harness() {
  const calls: EmbedCommand[] = [], scripts: string[] = [], packets: Packet[] = [];
  let drop: (packet: Packet) => boolean = () => false;
  let before: (script: string) => void = () => {};
  let command: (value: EmbedCommand) => void = value => { calls.push(value); };
  let page: Page;
  const transport = new WebScannerTransport(script => {
    scripts.push(script);
    before(script);
    new Function('window', script)(page);
    return true;
  });
  const freshPage = () => {
    page = {
      qrgen: { command: value => command(value) },
      ReactNativeWebView: { postMessage: raw => {
        const packet = JSON.parse(raw) as Packet;
        packets.push(packet);
        if (!drop(packet)) transport.receive(raw);
      } },
    };
  };
  freshPage();
  return { transport, calls, scripts, packets, freshPage,
    missing: () => { delete page.qrgen; },
    available: () => { page.qrgen = { command: value => command(value) }; },
    drop: (callback: typeof drop) => { drop = callback; },
    before: (callback: typeof before) => { before = callback; },
    command: (callback: typeof command) => { command = callback; },
    execute: (script: string) => { new Function('window', script)(page); },
  };
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });

it('admits explicit bootstrap after load without consuming camera-dependent commands', () => {
  const h = harness();
  h.transport.send({ type: 'pause' }); h.transport.send({ type: 'start' }); h.transport.send({ type: 'torch', value: true });
  expect(h.scripts).toEqual([]);
  h.transport.loaded();
  expect(h.calls).toEqual([{ type: 'start' }]);
  expect(h.transport.has('pause')).toBe(true); expect(h.transport.has('torch')).toBe(true);
  expect(jest.getTimerCount()).toBe(0);
  h.transport.ready();
  expect(h.calls).toEqual([{ type: 'start' }, { type: 'pause' }, { type: 'torch', value: true }]);
});

it('does not add a start when the page simply loads or reports ready', () => {
  const h = harness(); h.transport.loaded(); h.transport.ready();
  expect(h.calls).toEqual([]); expect(h.scripts).toEqual([]); expect(jest.getTimerCount()).toBe(0);
});

it('keeps checking real capability until a late module exists, with one capped timer', () => {
  const h = harness(); h.missing(); h.transport.send({ type: 'start' }); h.transport.loaded();
  for (let index = 0; index < 8; index++) {
    expect(jest.getTimerCount()).toBe(1); jest.advanceTimersByTime(1000);
    expect(h.calls).toEqual([]);
  }
  h.available(); jest.advanceTimersByTime(1000);
  expect(h.calls).toEqual([{ type: 'start' }]); expect(jest.getTimerCount()).toBe(0);
});

it('retains an entry when capability disappears between probe and dispatch', () => {
  const h = harness();
  h.before(script => { if (script.includes("packet.kind='dispatch'")) h.missing(); });
  h.transport.send({ type: 'start' }); h.transport.loaded();
  expect(h.calls).toEqual([]); expect(h.transport.has('start')).toBe(true);
  h.before(() => {}); h.available(); jest.advanceTimersByTime(1000);
  expect(h.calls).toEqual([{ type: 'start' }]); expect(h.transport.has('start')).toBe(false);
});

it('retries a lost dispatch acknowledgement without invoking start twice', () => {
  const h = harness(); h.drop(packet => packet.kind === 'dispatch');
  h.transport.send({ type: 'start' }); h.transport.loaded();
  expect(h.calls).toHaveLength(1); expect(h.transport.has('start')).toBe(true);
  h.drop(() => false); jest.advanceTimersByTime(1000);
  expect(h.calls).toEqual([{ type: 'start' }]); expect(h.transport.has('start')).toBe(false);
  expect(jest.getTimerCount()).toBe(0);
});

it('keeps lost-ack bootstrap on its admission path when camera-ready arrives before retry', () => {
  const h = harness(); h.drop(packet => packet.kind === 'dispatch');
  h.transport.send({ type: 'start' }); h.transport.send({ type: 'pause' }); h.transport.send({ type: 'torch', value: true });
  h.transport.loaded(); h.transport.ready();
  expect(h.calls).toEqual([{ type: 'start' }]);
  expect(h.transport.has('start')).toBe(true); expect(jest.getTimerCount()).toBe(1);
  h.drop(() => false); jest.advanceTimersByTime(1000);
  expect(h.calls).toEqual([{ type: 'start' }, { type: 'pause' }, { type: 'torch', value: true }]);
  expect(h.packets.filter(packet => packet.kind === 'dispatch' && packet.accepted)).toHaveLength(2);
  expect(h.transport.has('start')).toBe(false); expect(jest.getTimerCount()).toBe(0);
});

it('does not let a delayed old retry restart after a newer stop', () => {
  const h = harness(); h.drop(packet => packet.kind === 'dispatch');
  h.transport.send({ type: 'start' }); h.transport.loaded();
  const old = h.scripts.find(script => script.includes("packet.kind='dispatch'"))!;
  h.drop(() => false); jest.advanceTimersByTime(1000); h.transport.send({ type: 'stop' });
  expect(h.calls).toEqual([{ type: 'start' }, { type: 'stop' }]);
  h.execute(old);
  expect(h.calls).toEqual([{ type: 'start' }, { type: 'stop' }]);
});

it('rejects wrong nonce, owner, version, kind and entry acknowledgements', () => {
  const h = harness(); h.drop(() => true); h.transport.send({ type: 'start' }); h.transport.loaded();
  const probe = h.packets[0]!;
  for (const change of [{ nonce: -1 }, { owner: 'stale' }, { version: 2 }, { kind: 'dispatch' }, { available: 'yes' }]) {
    expect(h.transport.receive(JSON.stringify({ ...probe, ...change }))).toBe(true);
    expect(h.calls).toEqual([]);
  }
  h.transport.receive(JSON.stringify(probe));
  const dispatch = h.packets[h.packets.length - 1]!;
  h.transport.receive(JSON.stringify({ ...dispatch, id: -1 }));
  expect(h.transport.has('start')).toBe(true);
  h.transport.receive(JSON.stringify(dispatch)); expect(h.transport.has('start')).toBe(false);
  expect(h.transport.receive('bad JSON')).toBe(false);
  expect(h.transport.receive({ source: 'qrgen', type: 'ready' })).toBe(false);
});

it('ignores old document acknowledgements and re-admits retained work in a replacement', () => {
  const h = harness(); h.drop(() => true); h.transport.send({ type: 'start' }); h.transport.loaded();
  const old = h.packets[0]!; h.transport.reset(); h.freshPage();
  h.transport.receive(JSON.stringify(old)); expect(h.calls).toEqual([]);
  h.drop(() => false); h.transport.loaded();
  expect(h.calls).toEqual([{ type: 'start' }]); expect(jest.getTimerCount()).toBe(0);
});

it('coalesces each type while keeping bootstrap order and the latest torch intent', () => {
  const h = harness();
  h.transport.send({ type: 'start' }); h.transport.send({ type: 'stop' }); h.transport.send({ type: 'start' });
  h.transport.send({ type: 'torch', value: false }); h.transport.send({ type: 'torch', value: true });
  h.transport.loaded(); expect(h.calls).toEqual([{ type: 'stop' }, { type: 'start' }]);
  h.transport.ready(); expect(h.calls[h.calls.length - 1]).toEqual({ type: 'torch', value: true });
});

it('retains commands across a synchronous native injection failure', () => {
  const h = harness(); h.before(() => { throw new Error('native unavailable'); });
  h.transport.send({ type: 'start' }); h.transport.loaded();
  expect(h.transport.has('start')).toBe(true); expect(jest.getTimerCount()).toBe(1);
  h.before(() => {}); jest.advanceTimersByTime(1000);
  expect(h.calls).toEqual([{ type: 'start' }]); expect(jest.getTimerCount()).toBe(0);
});

it('can retry synchronous bridge command failure without falsely accepting it', () => {
  const h = harness(); h.command(() => { throw new Error('bridge failed'); });
  h.transport.send({ type: 'start' }); h.transport.loaded();
  expect(h.transport.has('start')).toBe(true);
  h.command(value => { h.calls.push(value); }); jest.advanceTimersByTime(1000);
  expect(h.calls).toEqual([{ type: 'start' }]); expect(h.transport.has('start')).toBe(false);
});

it('does not duplicate in-flight start when the bridge reports ready synchronously', () => {
  const h = harness();
  h.command(value => { h.calls.push(value); if (value.type === 'start') h.transport.ready(); });
  h.transport.send({ type: 'start' }); h.transport.send({ type: 'pause' }); h.transport.loaded();
  expect(h.calls).toEqual([{ type: 'start' }, { type: 'pause' }]); expect(jest.getTimerCount()).toBe(0);
});

it('stops queued continuations after a reentrant owner reset', () => {
  const h = harness(); h.transport.send({ type: 'pause' }); h.transport.send({ type: 'torch', value: true });
  h.command(value => { h.calls.push(value); h.transport.reset(); });
  h.transport.ready(); expect(h.calls).toEqual([{ type: 'pause' }]); expect(h.transport.has('torch')).toBe(true);
});

it('cancels all retry work and ignores completions after deactivation', () => {
  const h = harness(); h.drop(() => true); h.transport.send({ type: 'start' }); h.transport.loaded();
  const packet = h.packets[0]!, count = h.scripts.length;
  h.transport.deactivate(); h.transport.receive(JSON.stringify(packet)); h.transport.loaded(); h.transport.send({ type: 'stop' });
  jest.advanceTimersByTime(10000);
  expect(h.scripts).toHaveLength(count); expect(h.calls).toEqual([]); expect(jest.getTimerCount()).toBe(0);
});

it('cannot roll the page admission ledger backward with a delayed old probe', () => {
  const h = harness(); h.drop(packet => packet.kind === 'dispatch');
  h.transport.send({ type: 'start' }); h.transport.loaded();
  const oldProbe = h.scripts[0]!;
  h.transport.reset(); h.transport.loaded();
  expect(h.calls).toHaveLength(2);
  h.execute(oldProbe); h.drop(() => false); jest.advanceTimersByTime(1000);
  expect(h.calls).toHaveLength(2); expect(h.transport.has('start')).toBe(false);
});

it('keeps a failed navigation gated through loadEnd until a fresh load starts', () => {
  const h = harness(); h.transport.send({ type: 'start' }); h.transport.failed();
  h.transport.loaded(); h.transport.send({ type: 'start' }); jest.advanceTimersByTime(10000);
  expect(h.scripts).toEqual([]); expect(jest.getTimerCount()).toBe(0);
  h.transport.reset(); h.transport.loaded();
  expect(h.calls).toEqual([{ type: 'start' }]);
});

it('preserves an unsubmitted ready-time command when injection fails across reset', () => {
  const h = harness(); h.transport.send({ type: 'torch', value: true });
  h.before(() => { h.transport.reset(); throw new Error('replacement'); });
  h.transport.ready(); expect(h.transport.has('torch')).toBe(true);
  h.before(() => {}); h.transport.ready(); expect(h.calls).toEqual([{ type: 'torch', value: true }]);
});

it('does not let an unsolicited ready bypass the failed-navigation gate', () => {
  const h = harness(); h.transport.failed(); h.transport.send({ type: 'start' });
  expect(h.transport.ready()).toBe(false);
  expect(h.scripts).toEqual([]); expect(jest.getTimerCount()).toBe(0);
  h.transport.reset(); expect(h.transport.ready()).toBe(true);
  expect(h.calls).toEqual([{ type: 'start' }]);
});
