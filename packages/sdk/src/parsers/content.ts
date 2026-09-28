// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

import { parseAAMVA, type AamvaResult } from "./aamva.js";
import { isValidCheckDigit, parseDigitalLink, parseGS1, type GS1Result } from "./gs1.js";

export type ParsedContent =
  | { type: "url"; url: string }
  | { type: "gs1-digital-link"; url: string; gs1: GS1Result }
  | { type: "email"; to: string; subject?: string; body?: string }
  | { type: "phone"; number: string }
  | { type: "sms"; number: string; body?: string }
  | { type: "wifi"; ssid: string; password?: string; security: string; hidden: boolean }
  | { type: "geo"; latitude: number; longitude: number; altitude?: number; query?: string }
  | {
      type: "contact";
      format: "vcard" | "mecard";
      name?: string;
      organization?: string;
      title?: string;
      phones: string[];
      emails: string[];
      urls: string[];
      address?: string;
      note?: string;
    }
  | { type: "event"; summary?: string; start?: string; end?: string; location?: string; description?: string }
  | {
      type: "payment";
      scheme: "epc" | "bitcoin" | "ethereum" | "upi" | "other";
      address?: string;
      name?: string;
      iban?: string;
      bic?: string;
      amount?: number;
      currency?: string;
      reference?: string;
    }
  | { type: "product"; gtin: string; kind: "ean13" | "ean8" | "upca" | "upce" | "isbn" | "gtin14"; checksumValid: boolean }
  | { type: "gs1"; gs1: GS1Result }
  | { type: "aamva"; aamva: AamvaResult }
  | { type: "text"; text: string };

export interface ParseContentOptions {
  /** Symbology hint (e.g. "upce") used to disambiguate numeric data. */
  symbology?: string;
  now?: Date;
}

/** Split "KEY:value;KEY:value;;" with backslash escapes (WIFI:, MECARD:, MATMSG:). */
function splitFields(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  let key = "";
  let value = "";
  let inValue = false;
  for (let i = 0; i < body.length; i++) {
    const c = body[i]!;
    if (c === "\\" && i + 1 < body.length) {
      if (inValue) value += body[++i];
      else key += body[++i];
      continue;
    }
    if (!inValue && c === ":") {
      inValue = true;
      continue;
    }
    if (c === ";") {
      if (key) {
        const k = key.trim().toUpperCase();
        out[k] = k in out ? `${out[k]}\n${value}` : value;
      }
      key = "";
      value = "";
      inValue = false;
      continue;
    }
    if (inValue) value += c;
    else key += c;
  }
  if (key) out[key.trim().toUpperCase()] = value;
  return out;
}

/** Percent-decode a URI component. "+" stays literal (RFC 3986 / RFC 6068), e.g. jane+news@example.com. */
function decode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function query(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of s.split("&")) {
    if (!part) continue;
    const [k, ...rest] = part.split("=");
    out[decode(k!).toLowerCase()] = decode(rest.join("="));
  }
  return out;
}

/** Unfold and parse vCard / iCalendar content lines. */
function contentLines(text: string): { name: string; params: string; value: string }[] {
  const unfolded = text.replace(/\r?\n[ \t]/g, "");
  const out: { name: string; params: string; value: string }[] = [];
  for (const line of unfolded.split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const head = line.slice(0, idx);
    const [name, ...params] = head.split(";");
    const value = line
      .slice(idx + 1)
      .replace(/\\n/gi, "\n")
      .replace(/\\([,;\\])/g, "$1");
    out.push({ name: name!.split(".").pop()!.toUpperCase(), params: params.join(";").toUpperCase(), value });
  }
  return out;
}

function icsDate(v: string | undefined): string | undefined {
  if (!v) return undefined;
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(v.trim());
  if (!m) return v;
  const date = `${m[1]}-${m[2]}-${m[3]}`;
  return m[4] ? `${date}T${m[4]}:${m[5]}:${m[6] ?? "00"}${m[7] ?? ""}` : date;
}

function parseVCard(text: string): ParsedContent {
  const lines = contentLines(text);
  const get = (n: string) => lines.find((l) => l.name === n)?.value;
  let name = get("FN");
  if (!name) {
    const n = get("N");
    if (n) {
      const [last = "", first = "", middle = "", prefix = "", suffix = ""] = n.split(";");
      name = [prefix, first, middle, last, suffix].filter(Boolean).join(" ");
    }
  }
  const adr = get("ADR");
  return {
    type: "contact",
    format: "vcard",
    name: name || undefined,
    organization: get("ORG")?.replace(/;/g, " ").trim() || undefined,
    title: get("TITLE") || undefined,
    phones: lines.filter((l) => l.name === "TEL").map((l) => l.value.replace(/^tel:/i, "")),
    emails: lines.filter((l) => l.name === "EMAIL").map((l) => l.value),
    urls: lines.filter((l) => l.name === "URL").map((l) => l.value),
    address: adr ? adr.split(";").map((p) => p.trim()).filter(Boolean).join(", ") : undefined,
    note: get("NOTE") || undefined,
  };
}

function parseMeCard(body: string): ParsedContent {
  const f = splitFields(body);
  let name = f.N;
  if (name && name.includes(",")) {
    const [last, first] = name.split(",");
    name = `${first ?? ""} ${last ?? ""}`.trim();
  }
  const multi = (k: string) => (f[k] ? f[k]!.split("\n").filter(Boolean) : []);
  return {
    type: "contact",
    format: "mecard",
    name: name || undefined,
    organization: f.ORG || undefined,
    title: f.TITLE || undefined,
    phones: multi("TEL"),
    emails: multi("EMAIL"),
    urls: multi("URL"),
    address: f.ADR || undefined,
    note: f.NOTE || undefined,
  };
}

function parseEvent(text: string): ParsedContent {
  const lines = contentLines(text);
  const get = (n: string) => lines.find((l) => l.name === n)?.value;
  return {
    type: "event",
    summary: get("SUMMARY"),
    start: icsDate(get("DTSTART")),
    end: icsDate(get("DTEND")),
    location: get("LOCATION"),
    description: get("DESCRIPTION"),
  };
}

function parseEPC(text: string): ParsedContent | null {
  const l = text.split(/\r?\n/);
  if (l[0]?.trim() !== "BCD" || l[3]?.trim() !== "SCT") return null;
  const amountRaw = l[7]?.trim() ?? "";
  const am = /^([A-Z]{3})(\d+(?:\.\d{1,2})?)$/.exec(amountRaw);
  return {
    type: "payment",
    scheme: "epc",
    bic: l[4]?.trim() || undefined,
    name: l[5]?.trim() || undefined,
    iban: l[6]?.trim().replace(/\s+/g, "") || undefined,
    currency: am?.[1],
    amount: am ? Number(am[2]) : undefined,
    reference: (l[9]?.trim() || l[10]?.trim()) || undefined,
  };
}

function upceToUpca(upce: string): string | undefined {
  if (!/^[01]\d{7}$/.test(upce)) return undefined;
  const d = upce.slice(1, 7);
  const ns = upce[0]!;
  const check = upce[7]!;
  const last = d[5]!;
  let body: string;
  if (last <= "2") body = `${d.slice(0, 2)}${last}0000${d.slice(2, 5)}`;
  else if (last === "3") body = `${d.slice(0, 3)}00000${d.slice(3, 5)}`;
  else if (last === "4") body = `${d.slice(0, 4)}00000${d[4]}`;
  else body = `${d.slice(0, 5)}0000${last}`;
  return `${ns}${body}${check}`;
}

function parseProduct(data: string, symbology?: string): ParsedContent | null {
  if (!/^\d{8}$|^\d{12,14}$/.test(data)) return null;
  const sym = symbology?.toLowerCase();
  if (data.length === 8 && sym === "upce") {
    const upca = upceToUpca(data);
    if (!upca) return null;
    return { type: "product", kind: "upce", gtin: upca.padStart(14, "0"), checksumValid: isValidCheckDigit(upca) };
  }
  const kind =
    data.length === 8 ? "ean8" : data.length === 12 ? "upca" : data.length === 14 ? "gtin14" : /^97[89]/.test(data) ? "isbn" : "ean13";
  if (sym && !["ean13", "ean8", "upca", "upce", "isbn", "itf14", "itf", "databar", "code128"].includes(sym) && kind !== "gtin14") return null;
  return { type: "product", kind, gtin: data.padStart(14, "0"), checksumValid: isValidCheckDigit(data) };
}

/**
 * Detect and parse the payload of a scanned code: URLs, Wi-Fi credentials, contacts,
 * payments, GS1 data, driver licenses and more. Never throws; falls back to `{ type: "text" }`.
 */
export function parseContent(data: string, options: ParseContentOptions = {}): ParsedContent {
  const text = typeof data === "string" ? data : String(data ?? "");
  const t = text.trim();
  const upper = t.slice(0, 16).toUpperCase();
  try {
    if (t.startsWith("@") && /ANSI ?\d{6}|AAMVA\d{6}/.test(t)) {
      const aamva = parseAAMVA(text, { now: options.now });
      if (aamva) return { type: "aamva", aamva };
    }
    if (/^https?:\/\//i.test(t)) {
      const dl = parseDigitalLink(t);
      if (dl && dl.values["01"] !== undefined) return { type: "gs1-digital-link", url: t, gs1: dl };
      return { type: "url", url: t };
    }
    if (/^www\.[^\s]+\.[a-z]{2,}/i.test(t)) return { type: "url", url: `https://${t}` };
    if (upper.startsWith("WIFI:")) {
      const f = splitFields(t.slice(5));
      return {
        type: "wifi",
        ssid: f.S ?? "",
        password: f.P || undefined,
        security: (f.T || (f.P ? "WPA" : "nopass")).toUpperCase() === "NOPASS" ? "nopass" : (f.T || "WPA").toUpperCase(),
        hidden: /^true$/i.test(f.H ?? ""),
      };
    }
    if (upper.startsWith("MAILTO:")) {
      const [addr = "", q = ""] = t.slice(7).split("?");
      const params = query(q);
      return { type: "email", to: decode(addr), subject: params.subject, body: params.body };
    }
    if (upper.startsWith("MATMSG:")) {
      const f = splitFields(t.slice(7));
      return { type: "email", to: f.TO ?? "", subject: f.SUB || undefined, body: f.BODY || undefined };
    }
    if (/^tel:/i.test(t)) {
      let number = t.slice(4);
      try {
        number = decodeURIComponent(number);
      } catch {
        // keep as is
      }
      return { type: "phone", number };
    }
    if (/^(smsto|sms|mmsto):/i.test(t)) {
      const rest = t.replace(/^(smsto|sms|mmsto):/i, "");
      if (/^sms:[^?]*\?/i.test(t)) {
        const [num = "", q = ""] = rest.split("?");
        return { type: "sms", number: decode(num), body: query(q).body };
      }
      const [num = "", ...body] = rest.split(":");
      return { type: "sms", number: num, body: body.join(":") || undefined };
    }
    if (/^geo:/i.test(t)) {
      const m = /^geo:(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?:,(-?\d+(?:\.\d+)?))?(?:[;?](.*))?$/i.exec(t);
      if (m) {
        const q = m[4] ? query(m[4].replace(/;/g, "&")).q : undefined;
        return { type: "geo", latitude: Number(m[1]), longitude: Number(m[2]), altitude: m[3] ? Number(m[3]) : undefined, query: q };
      }
    }
    if (upper.startsWith("BEGIN:VCARD")) return parseVCard(t);
    if (upper.startsWith("MECARD:")) return parseMeCard(t.slice(7));
    if (upper.startsWith("BEGIN:VEVENT") || upper.startsWith("BEGIN:VCALENDAR")) return parseEvent(t);
    if (t.startsWith("BCD")) {
      const epc = parseEPC(t);
      if (epc) return epc;
    }
    const pay = /^(bitcoin|ethereum|litecoin|bitcoincash|dogecoin):([^?]+)(?:\?(.*))?$/i.exec(t);
    if (pay) {
      const params = query(pay[3] ?? "");
      const scheme = pay[1]!.toLowerCase();
      return {
        type: "payment",
        scheme: scheme === "bitcoin" ? "bitcoin" : scheme === "ethereum" ? "ethereum" : "other",
        address: pay[2]!.split("@")[0],
        // EIP-681 "value" is in wei; BIP-21 "amount" is in whole coins.
        amount: params.amount ? Number(params.amount) : params.value ? Number(params.value) / (scheme === "ethereum" ? 1e18 : 1) : undefined,
        name: params.label,
        reference: params.message,
        currency: scheme === "bitcoin" ? "BTC" : scheme === "ethereum" ? "ETH" : undefined,
      };
    }
    if (/^upi:\/\/pay\?/i.test(t)) {
      const params = query(t.slice(t.indexOf("?") + 1));
      return {
        type: "payment",
        scheme: "upi",
        address: params.pa,
        name: params.pn,
        amount: params.am ? Number(params.am) : undefined,
        currency: params.cu ?? "INR",
        reference: params.tn ?? params.tr,
      };
    }
    const product = parseProduct(t, options.symbology);
    if (product) return product;
    const gs1 = parseGS1(t);
    if (gs1) return { type: "gs1", gs1 };
    if (/^[\w.+-]+@[\w-]+\.[\w.-]+$/.test(t)) return { type: "email", to: t };
    if (/^\+?[\d\s().-]{7,}$/.test(t) && /\d{6,}/.test(t.replace(/\D/g, "")) && t.startsWith("+")) return { type: "phone", number: t };
  } catch {
    // fall through to text
  }
  return { type: "text", text };
}
