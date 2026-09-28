// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Base64-encode bytes in any JS runtime. */
export function toBase64(bytes: Uint8Array | undefined | null): string {
  if (!bytes || bytes.length === 0) return "";
  let out = "";
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + B64[(n >> 6) & 63]! + B64[n & 63]!;
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i]! << 16;
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + "==";
  } else if (rest === 2) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8);
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + B64[(n >> 6) & 63]! + "=";
  }
  return out;
}

/** Decode base64 (or a data: URL) into bytes in any JS runtime. */
export function fromBase64(input: string): Uint8Array {
  const s = input.replace(/^data:[^,]*,/, "").replace(/[^A-Za-z0-9+/]/g, "");
  const out = new Uint8Array(Math.floor((s.length * 3) / 4));
  let o = 0;
  let buf = 0;
  let bits = 0;
  for (let i = 0; i < s.length; i++) {
    buf = (buf << 6) | B64.indexOf(s[i]!);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (buf >> bits) & 0xff;
    }
  }
  return out.subarray(0, o);
}

export const isBrowser = typeof window !== "undefined" && typeof document !== "undefined";

export function now(): number {
  return Date.now();
}

export type Listener<T> = (payload: T) => void;

/** Minimal typed event emitter used by scanners. */
export class Emitter<Events extends Record<string, unknown>> {
  private listeners = new Map<keyof Events, Set<Listener<never>>>();

  on<K extends keyof Events>(event: K, listener: Listener<Events[K]>): () => void {
    let set = this.listeners.get(event);
    if (!set) this.listeners.set(event, (set = new Set()));
    set.add(listener as Listener<never>);
    return () => this.off(event, listener);
  }

  once<K extends keyof Events>(event: K, listener: Listener<Events[K]>): () => void {
    const off = this.on(event, (p) => {
      off();
      listener(p);
    });
    return off;
  }

  off<K extends keyof Events>(event: K, listener: Listener<Events[K]>): void {
    this.listeners.get(event)?.delete(listener as Listener<never>);
  }

  protected emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const l of [...set]) {
      try {
        (l as Listener<Events[K]>)(payload);
      } catch (err) {
        console.error("[qrgen] listener error", err);
      }
    }
  }

  removeAllListeners(): void {
    this.listeners.clear();
  }
}
