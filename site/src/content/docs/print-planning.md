---
title: QR print planning
description: "Plan a QR code for a physical print size, build common payloads and verify exported files."
group: Features
order: 5
---

Start with the [print planner](../../plan/) to make a website, text or Wi-Fi QR code using the available space and printer resolution. Content stays on your device. The interface keeps the white quiet zone, explains when a payload needs more room, and can scan the exported PNG back to check its content.

## Plan with the SDK

```js
import { buildUrlPayload, planQRCode } from "qrgen-sdk";

const data = buildUrlPayload("https://example.com/menu");
const plan = await planQRCode(data, { widthMm: 30, dpi: 203 });
if (plan.suitable) {
  // Send this to your existing SVG download helper.
  downloadSvg(plan.printSvg);
  console.log(plan.geometry.widthMm, plan.geometry.dotsPerModule);
} else {
  console.log(plan.diagnostics);
}
```

For Node.js, import from `qrgen-sdk/node` to use the locally packaged engine. These APIs do not yet have native Swift/Kotlin/Python equivalents.

The planner encodes the real payload at each permitted error-correction level. It includes four quiet-zone modules on every side, chooses whole printer dots and favors larger modules; ties favor stronger correction. Automatic mode permits M, Q and H. You can supply an exact `ecLevel`, a `minEcLevel` floor or a different `minDotsPerModule` profile.

The default three-dot minimum is a starting profile. It does not establish readability on a particular printer, material, camera or damaged label. Print an actual sample and test the devices people will use. Higher error correction may require a denser symbol and is not automatically the best choice for limited space.

The returned `target`, `candidates` and `diagnostics` explain the decision. An unsuitable plan has no rendered output and reports the minimum required width when encodable. Invalid inputs throw an error. Targets over 2048 printer dots are rejected to bound image allocations. Leading Unicode BOM is rejected because the current string writer would remove it; the planner never silently trims the payload.

## Export and check

`printSvg` has physical millimeter dimensions and the original viewBox. Print at 100% with fit-to-page disabled. `barcode.svg` and `barcode.png` retain pixel dimensions; a PNG needs the reported physical width and DPI applied by the printing application.

The planner's PNG check requires the decoded text to exactly match the encoded payload. This verifies the exported pixels with QRGen's reader. It does not verify a printed label, another scanner engine or an action such as joining Wi-Fi. Keep an equivalent readable link or instruction beside a published QR code.

## Wi-Fi and links

`buildUrlPayload(url)` accepts absolute HTTP(S) addresses and returns them unchanged. It rejects raw whitespace/backslashes, unsupported schemes and malformed Unicode.

```js
import { buildWifiPayload } from "qrgen-sdk";
const data = buildWifiPayload({
  ssid: "Café; room:1",
  authentication: "WPA",
  password: "example-password",
  hidden: false,
});
```

The Wi-Fi helper follows the [ZXing WIFI convention](https://github.com/zxing/zxing/wiki/Barcode-Contents#wi-fi-network-config-android-ios-11): delimiters are escaped, hex-looking text names/passwords receive quote wrappers, and open networks cannot include a password. The existing QRGen parser retains encoded quote wrappers. Text credentials with literal quotes at both ends are rejected for portability. The helper validates text bounds but does not test a router's credentials or phone support. Anyone with the code can read the credentials.
