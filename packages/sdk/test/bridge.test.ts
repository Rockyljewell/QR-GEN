import { describe, expect, it } from "vitest";
import { attributesFromQuery, parseBridgeMessage } from "../src/bridge";

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
});
