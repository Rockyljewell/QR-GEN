# Angular, Svelte, SvelteKit and other frameworks

These use the standard `<qrgen-scanner>` custom element. See [web.md](web.md) for attributes and events.

## Angular (standalone component)

```ts
import { Component, CUSTOM_ELEMENTS_SCHEMA, signal } from "@angular/core";
import "qrgen-sdk/elements";

@Component({
  selector: "app-scanner",
  standalone: true,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <qrgen-scanner symbologies="qr,ean13" mode="single" style="display:block;height:420px"
      (scan)="onScan($event)" (error)="onError($event)"></qrgen-scanner>
    @if (code()) { <p>{{ code() }}</p> }
  `,
})
export class ScannerComponent {
  code = signal("");
  onScan(e: Event) {
    this.code.set((e as CustomEvent).detail.barcode.data);
  }
  onError(e: Event) {
    console.warn((e as CustomEvent).detail);
  }
}
```

For NgModule apps add `CUSTOM_ELEMENTS_SCHEMA` to the module's `schemas`. With Angular SSR, render the
scanner only in the browser (`afterNextRender` or `@if (isBrowser)` via `isPlatformBrowser`).

## Svelte 5 / SvelteKit

```svelte
<script lang="ts">
  import { onMount } from "svelte";
  let code = $state("");
  onMount(() => import("qrgen-sdk/elements"));
</script>

<qrgen-scanner symbologies="qr,ean13" mode="single" style="height: 420px"
  onscan={(e: CustomEvent) => (code = e.detail.barcode.data)}></qrgen-scanner>
{#if code}<p>{code}</p>{/if}
```

Svelte 4 uses `on:scan={...}`. Importing inside `onMount` keeps SvelteKit SSR happy.

## Lit, Solid, Preact, Qwik, Astro

Import `qrgen-sdk/elements` on the client and render `<qrgen-scanner>`. Listen for the `scan` event with
`addEventListener` or the framework's custom-event binding. In Astro, use a `<script>` tag (it runs on the
client) and put the element in the page markup.
