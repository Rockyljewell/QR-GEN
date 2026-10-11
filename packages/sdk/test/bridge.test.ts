// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { attributesFromQuery, parseBridgeMessage } from "../src/bridge";
import { QRGenScannerElement } from "../src/elements/scanner-element";

describe("bridge", () => {
  it("maps embed query strings to element attributes", () => {
    expect(attributesFromQuery("?symbologies=qr,ean13&mode=single&beep=0&duplicateFilter=500&scanArea=0,0,1,1&x=1")).toEqual({
      symbologies: "qr,ean13",
      mode: "single",
      beep: "false",
      "duplicate-filter": "500",
      "scan-area": "0,0,1,1",
    });
  });
  it("parses messages from strings and objects", () => {
    const m = { source: "qrgen", version: 1, type: "ready" };
    expect(parseBridgeMessage(JSON.stringify(m))).toEqual(m);
    expect(parseBridgeMessage(m)).toEqual(m);
    expect(parseBridgeMessage({ source: "other", type: "scan" })).toBeNull();
    expect(parseBridgeMessage("not json")).toBeNull();
  });

  it.each(["maxResults=1&duplicateFilter=0", "max-results=1&duplicate-filter=0"])("applies numeric embed options to the scanner: %s", (query) => {
    const attributes = attributesFromQuery(`?mode=batch&${query}&camera=0&hint=1&beep=0&autostart=0`);
    const el = new QRGenScannerElement();
    Object.assign(el, {
      getAttribute: (name: string) => attributes[name] ?? null,
      hasAttribute: (name: string) => name in attributes,
    });
    expect(el.options).toMatchObject({ mode: "batch", maxResults: 1, duplicateFilter: 0, camera: "0", beep: false });
    expect(el.hint).toBe("1");
    expect(el.autostart).toBe(false);
  });
});
