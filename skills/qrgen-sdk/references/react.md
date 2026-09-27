# React and Next.js

```bash
npm install qrgen-sdk
```

## Component

```tsx
import { useState } from "react";
import { QRGenScanner, type Barcode } from "qrgen-sdk/react";

export function Scanner() {
  const [code, setCode] = useState<Barcode | null>(null);
  return (
    <div>
      <QRGenScanner
        symbologies={["qr", "ean13", "code128"]}
        mode="single"
        style={{ height: 420 }}
        onScan={(barcodes) => setCode(barcodes[0] ?? null)}
        onError={(e) => console.warn(e.code, e.message)}
      />
      {code && <p>{code.symbologyName}: {code.data}</p>}
    </div>
  );
}
```

Props: `symbologies`, `mode`, `duplicateFilter`, `beep`, `vibrate`, `camera`, `torch`, `viewfinder`,
`scanArea`, `maxResults`, `autostart`, `controls`, `accent`, `hint`, `toast`, `tryHarder`, `resolution`,
`className`, `style`, and the callbacks `onScan(barcodes, barcode)`, `onTrack({ tracked, added, removed })`,
`onSelect`, `onError({ code, message })`, `onReady({ engine })`, `onStateChange(state)`.

Imperative handle through `ref` (`QRGenScannerHandle`): `start`, `stop`, `pause`, `resume`, `setTorch`,
`toggleTorch`, `switchCamera`, `setZoom`, `element`.

```tsx
const ref = useRef<QRGenScannerHandle>(null);
<QRGenScanner ref={ref} mode="single" onScan={...} />
<button onClick={() => ref.current?.resume()}>Scan again</button>
```

Barcode images: `import { QRGenBarcode } from "qrgen-sdk/react"`, then
`<QRGenBarcode value="https://example.com" symbology="qr" style={{ width: 160 }} />`.

## Next.js (App Router)

The camera only exists in the browser. Use a client component and skip SSR:

```tsx
// app/scan/Scanner.tsx
"use client";
import { QRGenScanner } from "qrgen-sdk/react";
export default function Scanner() {
  return <QRGenScanner mode="single" style={{ height: 420 }} onScan={(b) => alert(b[0]?.data)} />;
}
```

```tsx
// app/scan/page.tsx
import dynamic from "next/dynamic";
const Scanner = dynamic(() => import("./Scanner"), { ssr: false });
export default function Page() {
  return <Scanner />;
}
```

In the Pages Router, `dynamic(() => import("../components/Scanner"), { ssr: false })` works the same.
Test on a phone over HTTPS (`next dev --experimental-https` or a tunnel).

## Scanning uploaded files

```tsx
import { scanImage } from "qrgen-sdk";
<input type="file" accept="image/*" onChange={async (e) => {
  const file = e.target.files?.[0];
  if (file) console.log(await scanImage(file, { symbologies: ["qr"] }));
}} />
```
