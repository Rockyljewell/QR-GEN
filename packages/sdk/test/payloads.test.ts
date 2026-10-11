// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { buildUrlPayload, buildWifiPayload, type WifiPayloadOptions } from "../src/payloads";
import { parseContent } from "../src/parsers/content";
import { planQRCode } from "../src/planner";
import { scan } from "../src/node";

describe("purpose-based payload builders", () => {
  it("preserves URL case, Unicode, percent escaping and query semantics", () => {
    const url = "HTTPS://例え.テスト/Café/e%CC%81?x=%2f&x=+&empty=#part";
    expect(buildUrlPayload(url)).toBe(url);
    expect(buildUrlPayload("http://localhost:8080/a%20b")).toBe("http://localhost:8080/a%20b");
  });

  it.each([
    "", "example.com", "https:example.com", "//example.com", "ftp://example.com", "javascript:alert(1)",
    " https://example.com", "https://example.com ", "https://example.com/a b", "https://example.com/\nfoo",
    "https://example.com\\a", "https://", "https://[invalid]", "https://example.com/\ud800", "x".repeat(7090),
  ])("rejects malformed or unsupported URL %s", (url) => {
    expect(() => buildUrlPayload(url)).toThrowError(expect.objectContaining({ code: "bad-request" }));
  });

  it("escapes every WIFI delimiter and preserves Unicode and surrounding spaces", async () => {
    const ssid = ' Café;:,\\" ';
    const password = ' pâss;:,\\" 🌍 ';
    const data = buildWifiPayload({ ssid, password, hidden: true });
    expect(data).toBe(String.raw`WIFI:T:WPA;S: Café\;\:\,\\\" ;P: pâss\;\:\,\\\" 🌍 ;H:true;;`);
    expect(parseContent(data)).toEqual({ type: "wifi", ssid, password, security: "WPA", hidden: true });
    const plan = await planQRCode(data, { widthMm: 40, dpi: 300 });
    expect(plan.suitable).toBe(true);
    if (!plan.suitable) throw new Error("Expected a suitable Wi-Fi code");
    const [decoded] = await scan(new Uint8Array(await plan.barcode.png!.arrayBuffer()));
    expect(decoded!.data).toBe(data);
    expect(parseContent(decoded!.data)).toEqual({ type: "wifi", ssid, password, security: "WPA", hidden: true });
  });

  it("omits credentials for open networks and distinguishes hex-looking text SSIDs", () => {
    expect(buildWifiPayload({ ssid: "Guest", authentication: "nopass" })).toBe("WIFI:T:nopass;S:Guest;;");
    expect(buildWifiPayload({ ssid: "Guest", authentication: "nopass", password: "" })).toBe("WIFI:T:nopass;S:Guest;;");
    expect(buildWifiPayload({ ssid: "ABCD", authentication: "nopass" })).toBe('WIFI:T:nopass;S:"ABCD";;');
    // Existing parser behavior is deliberately unchanged; joining readers interpret the standard wrapper.
    expect(parseContent(buildWifiPayload({ ssid: "ABCD", authentication: "nopass" }))).toMatchObject({ ssid: '"ABCD"' });
    expect(buildWifiPayload({ ssid: "Legacy", authentication: "WEP", password: "abcde" })).toBe('WIFI:T:WEP;S:Legacy;P:"abcde";;');
    expect(buildWifiPayload({ ssid: "ABCD", password: "0123ABCD" })).toBe('WIFI:T:WPA;S:"ABCD";P:"0123ABCD";;');
    expect(parseContent(buildWifiPayload({ ssid: "ABCD", password: "0123ABCD" }))).toMatchObject({ ssid: '"ABCD"', password: '"0123ABCD"' });
  });

  it("rejects contradictory credentials, nontext SSIDs, and malformed inputs", () => {
    const invalid: unknown[] = [
      null, undefined, {}, { ssid: "" }, { ssid: 123 }, { ssid: "A".repeat(33), authentication: "nopass" },
      { ssid: "界".repeat(11), authentication: "nopass" }, { ssid: "x\u0000", authentication: "nopass" },
      { ssid: "\ud800", authentication: "nopass" }, { ssid: "Network", authentication: "WPA3", password: "password" },
      { ssid: "Network" }, { ssid: "Network", password: "" }, { ssid: "Network", password: 123 },
      { ssid: "Network", authentication: "nopass", password: "secret" }, { ssid: "Network", authentication: "nopass", hidden: "false" },
      { ssid: "Network", password: "secret\nP:injected" }, { ssid: "Network", password: "a".repeat(257) },
      { ssid: '"Name"', authentication: "nopass" }, { ssid: "Network", password: '"password"' },
    ];
    for (const options of invalid) {
      expect(() => buildWifiPayload(options as WifiPayloadOptions)).toThrowError(expect.objectContaining({ code: "bad-request" }));
    }
  });
});
