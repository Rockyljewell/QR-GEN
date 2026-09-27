---
title: React
description: "Use the QRGenScanner and QRGenBarcode React components: props, event callbacks, the imperative ref handle, and server-side rendering notes."
group: Web
order: 4
badge: TypeScript
status: stable
---

`qrgen-sdk/react` provides two components that wrap the [web components](../web-components/): `QRGenScanner` for camera scanning and `QRGenBarcode` for rendering barcodes. They work with React 17, 18 and 19.

## Install

```bash
npm install qrgen-sdk
```

> **Note:** Until the first npm release is published, install the latest build with `npm install https://rockyljewell.github.io/QR-GEN/downloads/qrgen-sdk.tgz`.

## Scan

```tsx
import { useState } from "react";
import { QRGenScanner, type Barcode } from "qrgen-sdk/react";

export function CheckoutScanner() {
  const [items, setItems] = useState<Barcode[]>([]);

  return (
    <section>
      <QRGenScanner
        symbologies={["ean13", "upca", "upce", "code128"]}
        duplicateFilter={3000}
        style={{ height: 420 }}
        onScan={(barcodes) => setItems((prev) => [...barcodes, ...prev])}
        onError={(error) => console.warn(error.code, error.message)}
      />
      <ul>
        {items.map((b) => (
          <li key={`${b.timestamp}-${b.data}`}>
            {b.symbologyName}: {b.data}
          </li>
        ))}
      </ul>
    </section>
  );
}
```

The camera starts when the component mounts and stops when it unmounts. Camera access requires HTTPS or `http://localhost`.

## `QRGenScanner` props

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `symbologies` | `string[] \| string` | all | Ids, aliases or groups. |
| `mode` | `"single" \| "continuous" \| "batch"` | `"continuous"` | [Scan mode](../concepts/#scan-modes). |
| `duplicateFilter` | `number` | `1000` (`-1` in batch) | Milliseconds; `0` every frame, `-1` once per session. |
| `beep` | `boolean` | `true` | Tone on scan. |
| `vibrate` | `boolean` | `true` | Vibration on scan. |
| `camera` | `"back" \| "front" \| string` | `"back"` | Facing mode or `deviceId`. Changing it restarts the camera. |
| `torch` | `boolean` | `false` | Flashlight, where supported. |
| `viewfinder` | `"frame" \| "line" \| "none"` | depends on symbologies | Viewfinder style. |
| `scanArea` | `{ x, y, width, height }` | from the viewfinder | Normalized decode region. |
| `maxResults` | `number` | `1` (`20` in batch) | Codes per frame. |
| `autostart` | `boolean` | `true` | Start on mount. When `false`, a **Start scanning** screen is shown. |
| `controls` | `"default" \| "none"` | `"default"` | `"none"` hides the built-in buttons. |
| `accent` | `string` | `#5cc9d6` | Accent color (hex). |
| `hint` | `string` | mode-specific | Instruction text; `""` hides it. |
| `toast` | `boolean` | `true` | Success toast. |
| `tryHarder` | `boolean` | `false` | More CPU per frame for difficult codes. |
| `resolution` | `"sd" \| "hd" \| "fhd" \| "4k"` | `"hd"` | Camera resolution. |
| `className` | `string` | | Class on the `<qrgen-scanner>` element. |
| `style` | `CSSProperties` | | Inline style. Give the scanner a height. |

### Callbacks

| Prop | Signature | When |
| --- | --- | --- |
| `onScan` | `(barcodes: Barcode[], barcode: Barcode) => void` | New codes passed the duplicate filter. `barcode` is the first one. |
| `onTrack` | `(update: { tracked, added, removed }) => void` | Batch mode, every decoded frame. |
| `onSelect` | `(detail: { barcode: TrackedBarcode \| null, selected: boolean, selection: TrackedBarcode[] }) => void` | Batch mode tap-to-select. |
| `onError` | `(error: { code: QRGenErrorCode, message: string }) => void` | Starting failed. See [error codes](../options-events/#error-codes). |
| `onReady` | `(detail: { engine: "worker" \| "main" }) => void` | Scanning started. |
| `onStateChange` | `(state: ScannerState) => void` | `idle`, `starting`, `scanning`, `paused`, `stopped`, `error`. |

Callbacks always see the latest props, so inline arrow functions don't cause re-subscriptions.

## Ref handle

Pass a ref to control the scanner imperatively:

```tsx
import { useRef, useState } from "react";
import { QRGenScanner, type QRGenScannerHandle } from "qrgen-sdk/react";

export function LoginScanner({ onToken }: { onToken: (token: string) => void }) {
  const scanner = useRef<QRGenScannerHandle>(null);
  const [torch, setTorch] = useState(false);

  return (
    <div>
      <QRGenScanner
        ref={scanner}
        symbologies="qr"
        mode="single"
        controls="none"
        style={{ height: 360 }}
        onScan={(_, barcode) => onToken(barcode.data)}
      />
      <button onClick={() => scanner.current?.resume()}>Scan again</button>
      <button onClick={async () => setTorch((await scanner.current?.toggleTorch()) ?? false)}>Torch {torch ? "off" : "on"}</button>
      <button onClick={() => scanner.current?.switchCamera()}>Switch camera</button>
    </div>
  );
}
```

| Member | Returns |
| --- | --- |
| `start()` | `Promise<void>` |
| `stop()` | `void` |
| `pause()` | `void` |
| `resume()` | `void` |
| `setTorch(on)` | `Promise<boolean>` |
| `toggleTorch()` | `Promise<boolean>` |
| `switchCamera()` | `Promise<void>` |
| `setZoom(zoom)` | `Promise<boolean>` |
| `element` | The underlying `QRGenScannerElement`, or `null` before mount |

Use `element` for anything else the element offers, such as `clearSelection()`, `selection`, `lastResult` or the underlying `scanner` for `frame` events and `stats`:

```tsx
scanner.current?.element?.clearSelection();
console.log(scanner.current?.element?.scanner?.stats);
```

## Batch mode

```tsx
import { useState } from "react";
import { QRGenScanner, type TrackedBarcode } from "qrgen-sdk/react";

export function ShelfScanner() {
  const [inView, setInView] = useState<TrackedBarcode[]>([]);
  const [selected, setSelected] = useState<TrackedBarcode[]>([]);

  return (
    <>
      <QRGenScanner
        mode="batch"
        symbologies="retail"
        style={{ height: "70vh" }}
        onTrack={({ tracked }) => setInView(tracked)}
        onSelect={({ selection }) => setSelected(selection)}
      />
      <p>
        {inView.length} in view, {selected.length} selected
      </p>
    </>
  );
}
```

`onTrack` fires on every decoded frame (up to 24 times per second). If you render heavy UI from it, throttle the state updates. See [Batch scanning](../batch-scanning/).

## `QRGenBarcode`

```tsx
import { QRGenBarcode } from "qrgen-sdk/react";

export function Ticket({ id }: { id: string }) {
  return <QRGenBarcode value={`https://example.com/t/${id}`} symbology="qr" ecLevel="Q" style={{ width: 180 }} />;
}
```

Props: `value` (required), `symbology`, `scale`, `ecLevel`, `foreground`, `background`, `hrt`, `margin`, `gs1`, `rotate`, `alt`, `className`, `style`. They match the [`<qrgen-barcode>` attributes](../web-components/#qrgen-barcode).

## Server-side rendering

Both components are safe to import on the server. During SSR they render an empty `<qrgen-scanner>` or `<qrgen-barcode>` tag with attributes; the custom elements register and start in the browser. Nothing touches `window` or the camera at import time.

The components use hooks, so in frameworks with React Server Components (the Next.js App Router, for example) render them from a Client Component, a file that starts with `"use client"`. See [Next.js](../nextjs/). If you call `BarcodeScanner` or `scanImage` directly, do it in an effect or event handler, never during render.

## Without the wrapper

You can also use the element directly in JSX. Import `qrgen-sdk/elements` once to register it:

```tsx
import { useEffect, useRef } from "react";
import "qrgen-sdk/elements";
import type { Barcode } from "qrgen-sdk";

export function RawScanner() {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onScan = (e: Event) => console.log((e as CustomEvent<{ barcode: Barcode }>).detail.barcode.data);
    el.addEventListener("scan", onScan);
    return () => el.removeEventListener("scan", onScan);
  }, []);

  return <qrgen-scanner ref={ref} symbologies="qr" style={{ height: 400 }} />;
}
```

Importing `qrgen-sdk/react` anywhere in your app adds the JSX type declarations for `<qrgen-scanner>` and `<qrgen-barcode>`. Without it, declare them in your own `.d.ts` file.
