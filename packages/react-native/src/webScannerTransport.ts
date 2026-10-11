// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

import { buildCommandScript, type EmbedCommand } from './embed';

const source = 'qrgen-rn-transport';
let nextOwner = 0;
type Entry = { id: number; command: EmbedCommand; admission?: boolean };
type Attempt = { nonce: number; entry?: Entry };

/** Internal admission queue; camera readiness remains a separate public event. */
export class WebScannerTransport {
  private readonly instance = ++nextOwner;
  private generation = 0;
  private sequence = 0;
  private nonce = 0;
  private live = true;
  private loading = true;
  private failedPage = false;
  private cameraReady = false;
  private capable = false;
  private queue: Entry[] = [];
  private attempt: Attempt | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private delay = 100;
  private pumping = false;

  constructor(private readonly inject: (script: string) => boolean) {}

  get epoch(): number { return this.generation; }

  activate(): void { this.live = true; }

  deactivate(): void {
    this.live = false;
    this.generation++;
    this.loading = true;
    this.cameraReady = false;
    this.attempt = null;
    this.capable = false;
    this.cancelTimer();
  }

  reset(): void {
    this.generation++;
    this.loading = true;
    this.failedPage = false;
    this.cameraReady = false;
    this.capable = false;
    this.attempt = null;
    this.delay = 100;
    this.cancelTimer();
  }

  loaded(): void {
    if (!this.live || this.failedPage) return;
    this.loading = false;
    this.pump();
  }

  failed(): void {
    this.reset();
    this.failedPage = true;
  }

  has(type: EmbedCommand['type']): boolean {
    return this.queue.some(entry => entry.command.type === type);
  }

  send(command: EmbedCommand): void {
    if (!this.live) return;
    this.queue = this.queue.filter(entry => entry.command.type !== command.type);
    this.queue.push({ id: ++this.sequence, command });
    this.pump();
  }

  ready(): boolean {
    if (!this.live || this.failedPage) return false;
    this.loading = false;
    this.cameraReady = true;
    this.capable = true;
    this.pump();
    return true;
  }

  /** Returns true only for our private packets, including stale packets. */
  receive(raw: unknown): boolean {
    let value: unknown = raw;
    if (typeof raw === 'string') {
      try { value = JSON.parse(raw); } catch { return false; }
    }
    if (!value || typeof value !== 'object') return false;
    const message = value as Record<string, unknown>;
    if (message.source !== source) return false;
    const attempt = this.attempt;
    if (!this.live || !attempt || message.version !== 1 || message.owner !== this.owner || message.nonce !== attempt.nonce) return true;
    if (attempt.entry) {
      if (message.kind !== 'dispatch' || message.id !== attempt.entry.id || typeof message.accepted !== 'boolean') return true;
    } else if (message.kind !== 'capability' || typeof message.available !== 'boolean') return true;
    this.attempt = null;
    this.cancelTimer();
    const admitted = attempt.entry ? message.accepted === true : message.available === true;
    this.capable = admitted;
    if (admitted) {
      this.delay = 100;
      if (attempt.entry) this.queue = this.queue.filter(entry => entry.id !== attempt.entry!.id);
      this.pump();
    } else {
      this.retry();
    }
    return true;
  }

  private get owner(): string { return `${this.instance}:${this.generation}`; }

  private cancelTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private retry(): void {
    if (!this.live || this.loading || !this.queue.some(entry => this.bootstrap(entry.command))) return;
    this.cancelTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      this.attempt = null;
      this.capable = false;
      this.pump();
    }, this.delay);
    this.delay = Math.min(this.delay * 2, 1000);
  }

  private bootstrap(command: EmbedCommand): boolean {
    return command.type === 'start' || command.type === 'stop';
  }

  private pump(): void {
    if (this.pumping || !this.live || this.loading || this.attempt) return;
    this.pumping = true;
    try {
      while (this.live && !this.loading && !this.attempt) {
        // Camera-ready cannot resolve a lost dispatch ACK: keep that entry on
        // the page's deduplicated admission path until acceptance is known.
        const admission = this.queue.find(entry => entry.admission);
        if (this.cameraReady && !admission) {
          const entry = this.queue.shift();
          if (!entry) break;
          let sent = false;
          try { sent = this.inject(buildCommandScript(entry.command)); } catch { /* Retain an unsubmitted command. */ }
          if (!sent) {
            if (!this.has(entry.command.type)) this.queue.unshift(entry);
            break;
          }
          continue;
        }
        const entry = admission ?? this.queue.find(item => this.bootstrap(item.command));
        if (!entry) break;
        entry.admission = true;
        const attempt: Attempt = { nonce: ++this.nonce, ...(this.capable ? { entry } : {}) };
        this.attempt = attempt;
        this.retry(); // Install the timeout before an injection can acknowledge synchronously.
        try {
          if (!this.inject(this.script(attempt)) && this.attempt === attempt) this.attempt = null;
        } catch {
          if (this.attempt === attempt) this.attempt = null;
        }
        // Missing/throwing native injection is retried without losing the entry.
        if (this.attempt === attempt) break;
        if (this.timer !== null) break;
      }
    } finally {
      this.pumping = false;
    }
  }

  private script(attempt: Attempt): string {
    const owner = JSON.stringify(this.owner);
    const envelope = JSON.stringify({ source, version: 1, owner: this.owner, nonce: attempt.nonce });
    const dispatch = attempt.entry ? `
      var id=${attempt.entry.id};
      var accepted=false;
      if(available && state.owner===owner){
        if(id===state.accepted) accepted=true;
        else if(id>state.accepted && state.running!==id){
          state.running=id;
          try{ window.qrgen.command(${JSON.stringify(attempt.entry.command)}); state.accepted=id; accepted=true; }
          catch(_){} finally{ state.running=0; }
        }
      }
      packet.kind='dispatch';packet.id=id;packet.accepted=accepted;
    ` : `packet.kind='capability';packet.available=available;`;
    return `(function(){
      var owner=${owner};
      var instance=${this.instance},generation=${this.generation};
      var key='__qrgenRNTransport';
      var state=window[key];
      ${attempt.entry ? '' : `if(!state || state.instance<instance || (state.instance===instance && state.generation<generation))
        state=window[key]={owner:owner,instance:instance,generation:generation,accepted:0,running:0};`}
      var available=!!(state && state.owner===owner && window.qrgen && typeof window.qrgen.command==='function');
      var packet=${envelope};
      ${dispatch}
      if(window.ReactNativeWebView && typeof window.ReactNativeWebView.postMessage==='function')
        window.ReactNativeWebView.postMessage(JSON.stringify(packet));
    })(); true;`;
  }
}
