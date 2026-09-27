---
name: qrgen-testing
description: Test barcode scanning features built with QRGen without a physical camera or printed labels. Covers unit tests that generate a code and scan it back (Vitest/Jest/pytest), Playwright/Chromium end-to-end tests with a fake webcam video containing barcodes, testing parsers with fixed dates, and CI setup. Use when writing tests for a scanner screen, verifying an integration works, or debugging "it scans on my phone but tests fail".
---

# Testing QRGen integrations

## 1. Round-trip unit tests (fastest, run everywhere)

Generate a real barcode image, scan it, and assert on the result. No camera and no fixtures to maintain.

```ts
// vitest / jest (Node)
import { describe, expect, it } from "vitest";
import { generatePNG, scan } from "qrgen-sdk/node";

describe("barcode handling", () => {
  it("reads a GS1 Data Matrix", async () => {
    const png = await generatePNG("(01)09501101530003(17)271231(10)LOT1", { symbology: "data-matrix", gs1: true });
    const [code] = await scan(png, { symbologies: ["data-matrix"] });
    expect(code.isGS1).toBe(true);
    expect(code.data).toBe("(01)09501101530003(17)271231(10)LOT1");
  });
});
```

Use this to test your own result handler: feed `code` (a real `Barcode` object) into the function your
`scan` event calls.

Python:

```python
import qrgen_sdk
def test_round_trip():
    png = qrgen_sdk.generate("hello", symbology="qr", format="png")
    assert qrgen_sdk.scan(png)[0].data == "hello"
```

## 2. Browser end-to-end tests with a fake camera (Playwright + Chromium)

Chromium can use a `.y4m` video file as its webcam. `scripts/fake-camera.mjs` (next to this file)
writes one with barcodes painted into every frame:

```js
import { chromium } from "playwright";
import { writeFakeCamera } from "./fake-camera.mjs";

await writeFakeCamera("test/qr.y4m", [
  { data: "https://example.com/item/42", symbology: "qr", x: 230, y: 150, module: 6 },
]);
const browser = await chromium.launch({
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--use-file-for-fake-video-capture=test/qr.y4m"],
});
const page = await browser.newPage();
await page.goto("http://localhost:5173/scan");
const code = await page.evaluate(
  () => new Promise((resolve) => document.querySelector("qrgen-scanner").addEventListener("scan", (e) => resolve(e.detail.barcode.data))),
);
// assert code === "https://example.com/item/42"
```

Tips:

- Put codes near the center for `single`/`continuous` modes. The element decodes only the viewfinder
  region. Batch mode decodes the full frame.
- `--use-fake-ui-for-media-stream` auto-accepts the permission prompt. For a denied-permission test, grant
  no permissions in the Playwright context and assert on the `error` event (`camera-permission-denied`).
- `localhost` is a secure context, so no HTTPS is needed in CI.
- Linear codes: use `module: 3` or more and leave space around them (quiet zone).

## 3. Parsers with fixed clocks

`parseAAMVA(data, { now: new Date("2026-06-01") })` makes age and expiry checks deterministic. GS1 dates
use a sliding century window. Test with explicit YYMMDD values and compare the ISO `date` field.

## 4. What to assert

- The correct `symbology` id and `data` string (not just "something was found").
- `isGS1` and parsed AIs for GS1 flows. `parseContent(...).type` for QR payload features.
- The scanner is stopped when the view unmounts (no camera light left on). In the browser, check that
  `el.state === "stopped"` or `"idle"` after navigation.

## 5. CI

Node tests need nothing extra (the wasm ships in `node_modules`). Playwright needs Chromium
(`npx playwright install chromium`). Python needs `pip install qrgen-sdk` (wheels for Linux, macOS and
Windows via `zxing-cpp`).
