---
title: Angular
description: "Use the <qrgen-scanner> and <qrgen-barcode> custom elements in Angular with CUSTOM_ELEMENTS_SCHEMA, event and property bindings, and zone-aware setup."
group: Web
order: 7
badge: TypeScript
status: stable
---

Angular supports custom elements natively, so you use QRGen's [web components](../web-components/) directly. There is no wrapper package to install or keep in sync with your Angular version.

## Install

```bash
npm install qrgen-sdk
```

> **Note:** Until the first npm release is published, install the latest build with `npm install https://rockyljewell.github.io/QR-GEN/downloads/qrgen-sdk.tgz`.

## Standalone component

Import `qrgen-sdk/elements` to register the elements, and add `CUSTOM_ELEMENTS_SCHEMA` so the template compiler accepts the unknown tags and attributes:

```ts
// scanner.component.ts
import { JsonPipe } from "@angular/common";
import { Component, CUSTOM_ELEMENTS_SCHEMA, signal } from "@angular/core";
import "qrgen-sdk/elements";
import { parseContent, type Barcode, type ParsedContent, type QRGenErrorCode } from "qrgen-sdk";

type ScanDetail = { barcodes: Barcode[]; barcode: Barcode };
type ErrorDetail = { code: QRGenErrorCode; message: string };

@Component({
  selector: "app-scanner",
  standalone: true,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <qrgen-scanner
      [symbologies]="symbologies"
      mode="continuous"
      duplicate-filter="2000"
      accent="#dd0031"
      style="display: block; height: 420px"
      (scan)="onScan($event)"
      (error)="onError($event)"
    ></qrgen-scanner>

    @if (result(); as r) {
      <pre>{{ r | json }}</pre>
    }
    @if (error(); as e) {
      <p class="error">{{ e }}</p>
    }
  `,
  imports: [JsonPipe],
})
export class ScannerComponent {
  symbologies = ["qr", "ean13", "code128"];
  result = signal<ParsedContent | null>(null);
  error = signal<string | null>(null);

  onScan(event: Event) {
    const { barcode } = (event as CustomEvent<ScanDetail>).detail;
    this.result.set(parseContent(barcode.data, { symbology: barcode.symbology }));
  }

  onError(event: Event) {
    const { code, message } = (event as CustomEvent<ErrorDetail>).detail;
    this.error.set(`${code}: ${message}`);
  }
}
```

The `@if` block syntax and `viewChild()` below need Angular 17.2 or later; on older versions use `*ngIf` and `@ViewChild`.

Camera access requires HTTPS or `http://localhost`. `ng serve` uses `http://localhost:4200`, which works; to test on a phone, run `ng serve --ssl --host 0.0.0.0`.

## Bindings

- **Attributes** (`mode="single"`, `duplicate-filter="2000"`) pass strings, exactly like HTML.
- **Property bindings** (`[symbologies]="list"`, `[scanArea]="area"`, `[beep]="false"`) pass typed values to the element's properties. The element has properties for `symbologies`, `mode`, `duplicateFilter`, `beep`, `vibrate`, `camera`, `torch`, `viewfinder`, `scanArea`, `maxResults` and `autostart`.
- **Attribute bindings** (`[attr.hint]="hintText"`, `[attr.controls]="'none'"`) for everything else: `controls`, `accent`, `hint`, `toast`, `try-harder`, `resolution`, `worker`.
- **Event bindings**: `(scan)`, `(track)`, `(select)`, `(ready)`, `(statechange)` and `(error)`. `$event` is a `CustomEvent`; the payload is in `detail`. The shapes are in [Web Components](../web-components/#events).

## Control the scanner

Get the element with a template reference and call its methods:

```ts
import { Component, CUSTOM_ELEMENTS_SCHEMA, ElementRef, viewChild } from "@angular/core";
import "qrgen-sdk/elements";
import type { QRGenScannerElement } from "qrgen-sdk/elements";

@Component({
  selector: "app-login-scanner",
  standalone: true,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <qrgen-scanner #scanner symbologies="qr" mode="single" controls="none" style="display: block; height: 360px" (scan)="onScan($event)"></qrgen-scanner>
    <button (click)="scanner.resume()">Scan again</button>
    <button (click)="scanner.toggleTorch()">Torch</button>
  `,
})
export class LoginScannerComponent {
  scannerRef = viewChild.required<ElementRef<QRGenScannerElement>>("scanner");

  onScan(event: Event) {
    const token = (event as CustomEvent<{ barcode: { data: string } }>).detail.barcode.data;
    console.log("token", token);
  }

  stop() {
    this.scannerRef().nativeElement.stop();
  }
}
```

The element stops the camera by itself when Angular removes it from the DOM, so you don't need an `ngOnDestroy` hook.

## Zones and change detection

With zone.js, event bindings like `(scan)` run inside the Angular zone, so change detection runs after each scan and your template updates.

The scanner's internal animation frames also run inside the zone, because the element starts from Angular's rendering. On slow devices you can move that work outside the zone: set `autostart="false"`, start the element with `NgZone.runOutsideAngular()`, and keep your `(scan)` handlers as they are. Handlers registered from the template still run in the zone.

```ts
import { AfterViewInit, Component, CUSTOM_ELEMENTS_SCHEMA, ElementRef, NgZone, inject, viewChild } from "@angular/core";
import "qrgen-sdk/elements";
import type { QRGenScannerElement } from "qrgen-sdk/elements";

@Component({
  selector: "app-fast-scanner",
  standalone: true,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `<qrgen-scanner #scanner autostart="false" style="display: block; height: 420px" (scan)="onScan($event)"></qrgen-scanner>`,
})
export class FastScannerComponent implements AfterViewInit {
  private zone = inject(NgZone);
  private scanner = viewChild.required<ElementRef<QRGenScannerElement>>("scanner");

  ngAfterViewInit() {
    this.zone.runOutsideAngular(() => void this.scanner().nativeElement.start().catch(() => undefined));
  }

  onScan(event: Event) {
    console.log((event as CustomEvent).detail.barcode.data);
  }
}
```

With zoneless change detection (`provideZonelessChangeDetection()`), update a signal in the event handler, as in the first example, and the view updates.

## `<qrgen-barcode>`

```html
<qrgen-barcode [attr.value]="ticketUrl" symbology="qr" ec-level="Q" style="width: 180px"></qrgen-barcode>
```

`value` is also a property, so `[value]="ticketUrl"` works too. All attributes are listed in [Web Components](../web-components/#qrgen-barcode).

## Self-host the wasm

Copy the wasm files into your build with the `assets` option in `angular.json`:

```json
{
  "projects": {
    "app": {
      "architect": {
        "build": {
          "options": {
            "assets": [
              { "glob": "**/*", "input": "public" },
              { "glob": "*.wasm", "input": "node_modules/qrgen-sdk/dist/wasm", "output": "qrgen" }
            ]
          }
        }
      }
    }
  }
}
```

Then configure the engine in `main.ts`, before bootstrapping:

```ts
// main.ts
import { bootstrapApplication } from "@angular/platform-browser";
import { configure } from "qrgen-sdk";
import { AppComponent } from "./app/app.component";

configure({ wasmBaseUrl: "qrgen/" });

bootstrapApplication(AppComponent).catch((err) => console.error(err));
```

A relative `wasmBaseUrl` resolves against the document's `<base href>`, so it works when the app is deployed under a sub-path.

## Server-side rendering

Importing `qrgen-sdk/elements` is safe during Angular SSR: registration is skipped on the server and the tag is rendered as is. The element starts in the browser after hydration.
