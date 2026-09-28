// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

import { DIGITAL_LINK_NAMES, GS1_AIS, PREDEFINED_LENGTH_PREFIXES, matchAI } from "./gs1-ais.js";

export interface GS1Element {
  ai: string;
  title: string;
  description: string;
  value: string;
  /** ISO date (YYYY-MM-DD) for date AIs. */
  date?: string;
  /** Numeric value for decimal AIs (weights, measures, amounts). */
  number?: number;
  /** ISO 4217 currency / ISO 3166 country code for AIs that carry one. */
  iso?: string;
  /** Result of the mod-10 check digit test for AIs that carry one. */
  checkDigitValid?: boolean;
}

export interface GS1Result {
  elements: GS1Element[];
  /** AI → value (first occurrence wins). */
  values: Record<string, string>;
  /** Present when the input was a GS1 Digital Link URL. */
  digitalLink?: string;
}

const GS = "\u001d";
const SYMBOLOGY_PREFIX = /^\](C1|e0|d2|Q3|J1|z[0-9A-C])/;

/** GS1 mod-10 check digit test over a numeric string (last digit is the check digit). */
export function isValidCheckDigit(digits: string): boolean {
  if (!/^\d{2,}$/.test(digits)) return false;
  let sum = 0;
  const body = digits.slice(0, -1);
  for (let i = 0; i < body.length; i++) {
    const n = body.charCodeAt(body.length - 1 - i) - 48;
    sum += i % 2 === 0 ? n * 3 : n;
  }
  return (10 - (sum % 10)) % 10 === Number(digits[digits.length - 1]);
}

/** Compute the GS1 mod-10 check digit for a numeric string without one. */
export function computeCheckDigit(body: string): number {
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    const n = body.charCodeAt(body.length - 1 - i) - 48;
    sum += i % 2 === 0 ? n * 3 : n;
  }
  return (10 - (sum % 10)) % 10;
}

function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** YYMMDD → YYYY-MM-DD using the GS1 sliding century rule. Day 00 = last day of month. */
export function gs1Date(yymmdd: string, now: Date = new Date()): string | undefined {
  if (!/^\d{6}$/.test(yymmdd)) return undefined;
  const yy = Number(yymmdd.slice(0, 2));
  const mm = Number(yymmdd.slice(2, 4));
  let dd = Number(yymmdd.slice(4, 6));
  if (mm < 1 || mm > 12) return undefined;
  const current = now.getUTCFullYear();
  const currentYY = current % 100;
  let century = Math.floor(current / 100);
  const diff = yy - currentYY;
  if (diff >= 51) century -= 1;
  else if (diff <= -50) century += 1;
  const year = century * 100 + yy;
  const last = lastDayOfMonth(year, mm);
  if (dd === 0) dd = last;
  if (dd > last) return undefined;
  return `${year}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

function buildElement(ai: string, value: string): GS1Element {
  const def = GS1_AIS[ai];
  const el: GS1Element = {
    ai,
    title: def?.title ?? `AI ${ai}`,
    description: def?.description ?? "Unknown application identifier",
    value,
  };
  if (!def) return el;
  if (def.date) {
    const date = gs1Date(value);
    if (date) el.date = date;
  }
  if (def.check) el.checkDigitValid = isValidCheckDigit(value);
  let numeric = value;
  if (def.isoPrefix && value.length > 3) {
    el.iso = value.slice(0, 3);
    numeric = value.slice(3);
  }
  if (def.decimal && /^\d+$/.test(numeric)) {
    const places = Number(ai[ai.length - 1]);
    el.number = Number(numeric) / Math.pow(10, places);
  }
  if (ai === "7250" && /^\d{8}$/.test(value)) el.date = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  return el;
}

function finish(elements: GS1Element[], digitalLink?: string): GS1Result | null {
  if (elements.length === 0) return null;
  const values: Record<string, string> = {};
  for (const el of elements) if (!(el.ai in values)) values[el.ai] = el.value;
  return digitalLink ? { elements, values, digitalLink } : { elements, values };
}

/** Parse "(01)09501101530003(17)250101(10)ABC123" style input. */
function parseHRI(input: string): GS1Result | null {
  const markers: { ai: string; start: number; end: number }[] = [];
  const re = /\((\d{2,4})\)/g;
  let m: RegExpExecArray | null;
  // Every "(nn)" is an element boundary; unknown AIs become "AI nnnn" elements instead of
  // being glued onto the previous value.
  while ((m = re.exec(input))) markers.push({ ai: m[1]!, start: m.index, end: m.index + m[0].length });
  if (markers.length === 0 || markers[0]!.start !== 0) return null;
  if (!markers.some((mk) => GS1_AIS[mk.ai])) return null;
  const elements = markers.map((mk, i) => {
    const next = markers[i + 1];
    const value = input.slice(mk.end, next ? next.start : undefined).replace(new RegExp(GS, "g"), "");
    return buildElement(mk.ai, value);
  });
  return finish(elements);
}

/** Parse a raw element string ("0109501101530003172501011" + GS + ...). */
function parseRaw(input: string): GS1Result | null {
  let s = input.replace(SYMBOLOGY_PREFIX, "");
  if (s.startsWith(GS)) s = s.slice(1);
  const elements: GS1Element[] = [];
  let pos = 0;
  while (pos < s.length) {
    if (s[pos] === GS) {
      pos++;
      continue;
    }
    const ai = matchAI(s.slice(pos));
    if (!ai) return null;
    const def = GS1_AIS[ai]!;
    pos += ai.length;
    let value: string;
    if (def.fixed) {
      value = s.slice(pos, pos + def.fixed);
      if (value.length !== def.fixed) return null;
      pos += def.fixed;
      // Some encoders emit a separator even after predefined-length AIs.
      if (s[pos] === GS) pos++;
    } else {
      const gs = s.indexOf(GS, pos);
      const end = gs === -1 ? s.length : gs;
      value = s.slice(pos, end);
      if (def.max && value.length > def.max) {
        // Missing separator: split at the maximum length.
        value = value.slice(0, def.max);
        pos += def.max;
      } else {
        pos = gs === -1 ? s.length : gs + 1;
      }
    }
    if (def.numeric && !/^\d*$/.test(value)) return null;
    elements.push(buildElement(ai, value));
  }
  // Raw numeric strings are ambiguous; require at least one AI with a predefined length
  // or a separator so plain numbers are not mistaken for GS1 data.
  const plausible = elements.some((e) => PREDEFINED_LENGTH_PREFIXES.has(e.ai.slice(0, 2))) || input.includes(GS) || SYMBOLOGY_PREFIX.test(input);
  return plausible ? finish(elements) : null;
}

const PRIMARY_KEYS = new Set(["00", "01", "253", "255", "401", "402", "414", "417", "8003", "8004", "8006", "8010", "8013", "8017", "8018"]);

/** Parse a GS1 Digital Link URI such as https://id.gs1.org/01/09501101530003/10/ABC?17=250101 */
export function parseDigitalLink(input: string): GS1Result | null {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const segments = url.pathname.split("/").filter(Boolean).map((p) => {
    try {
      return decodeURIComponent(p);
    } catch {
      return p;
    }
  });
  const toAI = (key: string): string | undefined => (GS1_AIS[key] ? key : DIGITAL_LINK_NAMES[key]);
  let start = -1;
  for (let i = 0; i < segments.length - 1; i++) {
    const ai = toAI(segments[i]!);
    if (ai && PRIMARY_KEYS.has(ai)) {
      start = i;
      break;
    }
  }
  if (start === -1) return null;
  const elements: GS1Element[] = [];
  for (let i = start; i + 1 < segments.length; i += 2) {
    const ai = toAI(segments[i]!);
    if (!ai) break;
    let value = segments[i + 1]!;
    // GTINs shorter than 14 digits are zero padded in element strings.
    if (ai === "01" && /^\d{8,13}$/.test(value)) value = value.padStart(14, "0");
    elements.push(buildElement(ai, value));
  }
  url.searchParams.forEach((value, key) => {
    const ai = toAI(key);
    if (ai) elements.push(buildElement(ai, value));
  });
  return finish(elements, input);
}

/**
 * Parse GS1 element strings in HRI form, raw FNC1/GS form or as a GS1 Digital Link URL.
 * Returns null when the input is not GS1 data.
 */
export function parseGS1(input: string): GS1Result | null {
  if (typeof input !== "string" || input.length < 3) return null;
  const s = input.trim();
  try {
    if (s.startsWith("(")) return parseHRI(s);
    if (/^https?:\/\//i.test(s)) return parseDigitalLink(s);
    if (/^(\]..)?\u001d?\d{2}/.test(s)) return parseRaw(s);
  } catch {
    return null;
  }
  return null;
}

/** Format a GS1 result back into HRI "(AI)value" form. */
export function formatGS1(result: Pick<GS1Result, "elements">): string {
  return result.elements.map((e) => `(${e.ai})${e.value}`).join("");
}
