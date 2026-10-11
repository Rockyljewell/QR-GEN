// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

import { QRGenError } from "./errors.js";

export interface WifiPayloadOptions {
  /** Text SSID, preserved exactly, with a maximum of 32 UTF-8 bytes. */
  ssid: string;
  /** The interoperable WIFI convention's labels. Default WPA, also used for WPA2 Personal. */
  authentication?: "WPA" | "WEP" | "nopass";
  /** Required for WPA/WEP. A text password, not a raw hexadecimal key; router-specific rules are not checked. */
  password?: string;
  hidden?: boolean;
}

function invalid(message: string): never {
  throw new QRGenError("bad-request", message);
}

function checkedText(name: string, text: string, maxBytes: number, allowEmpty = false): string {
  if (typeof text !== "string" || (!allowEmpty && text.length === 0) || text.length > maxBytes) {
    invalid(`${name} must be ${allowEmpty ? "a" : "a nonempty"} string of at most ${maxBytes} UTF-8 bytes.`);
  }
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = text.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) invalid(`${name} contains an unpaired Unicode surrogate.`);
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      invalid(`${name} contains an unpaired Unicode surrogate.`);
    }
  }
  if (/[\u0000-\u001f\u007f]/.test(text)) invalid(`${name} cannot contain control characters.`);
  if (new TextEncoder().encode(text).length > maxBytes) invalid(`${name} exceeds ${maxBytes} UTF-8 bytes.`);
  return text;
}

/** Validate an absolute HTTP(S) URL and return it unchanged, including Unicode, case and query escaping. */
export function buildUrlPayload(url: string): string {
  checkedText("URL", url, 7089);
  if (!/^https?:\/\//i.test(url) || /[\s\\]/u.test(url)) {
    invalid("URL must be an absolute HTTP(S) URL without raw whitespace or backslashes. Encode spaces as %20.");
  }
  let parsed: URL;
  try { parsed = new URL(url); } catch { invalid("URL is not a valid absolute HTTP(S) URL."); }
  if ((parsed.protocol !== "https:" && parsed.protocol !== "http:") || !parsed.hostname) {
    invalid("URL must use HTTP or HTTPS and include a hostname.");
  }
  return url;
}

function encodeWifiText(text: string): string {
  // Unescaped wrappers distinguish literal text from raw hexadecimal SSIDs/keys.
  return /^[0-9a-f]+$/i.test(text) ? `"${text}"` : text.replace(/[\\;,":]/g, (character) => `\\${character}`);
}

/**
 * Build the widely supported WIFI: payload convention (ZXing Barcode Contents).
 * Escapes delimiters and preserves Unicode and whitespace. Hex-looking text SSIDs
 * and passwords receive quote wrappers to distinguish text from hexadecimal values.
 * parseContent currently retains those encoded wrappers. Literal quotes at both
 * ends of a name/password are rejected because some readers treat them as wrappers.
 * Reader support varies; this encodes credentials without connecting to the network.
 * See https://github.com/zxing/zxing/wiki/Barcode-Contents#wi-fi-network-config-android-ios-11
 */
export function buildWifiPayload(options: WifiPayloadOptions): string {
  if (!options || typeof options !== "object") invalid("Wi-Fi payload requires an SSID.");
  const ssid = checkedText("SSID", options.ssid, 32);
  if (ssid.startsWith('"') && ssid.endsWith('"')) invalid("An SSID with literal quotes at both ends is not portable across Wi-Fi readers.");
  const authentication = options.authentication === undefined ? "WPA" : options.authentication;
  if (authentication !== "WPA" && authentication !== "WEP" && authentication !== "nopass") {
    invalid("Wi-Fi authentication must be WPA, WEP, or nopass.");
  }
  if (options.hidden !== undefined && typeof options.hidden !== "boolean") invalid("hidden must be a boolean.");
  if (options.password !== undefined) checkedText("Password", options.password, 256, true);
  if (options.password?.startsWith('"') && options.password.endsWith('"')) {
    invalid("A password with literal quotes at both ends is not portable across Wi-Fi readers.");
  }
  if (authentication === "nopass" && options.password) invalid("An open Wi-Fi network cannot include a password.");
  if (authentication !== "nopass" && !options.password) invalid("A WPA or WEP Wi-Fi network requires a password.");
  const fields = [`T:${authentication}`, `S:${encodeWifiText(ssid)}`];
  if (authentication !== "nopass") fields.push(`P:${encodeWifiText(options.password!)}`);
  if (options.hidden === true) fields.push("H:true");
  return `WIFI:${fields.join(";")};;`;
}
