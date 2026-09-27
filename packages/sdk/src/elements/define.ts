import { QRGenBarcodeElement } from "./barcode-element.js";
import { QRGenScannerElement } from "./scanner-element.js";

/**
 * Register `<qrgen-scanner>` and `<qrgen-barcode>`. Called automatically when you
 * `import "qrgen-sdk/elements"`; safe to call more than once and on the server.
 */
export function defineElements(): void {
  if (typeof customElements === "undefined") return;
  if (!customElements.get("qrgen-scanner")) customElements.define("qrgen-scanner", QRGenScannerElement);
  if (!customElements.get("qrgen-barcode")) customElements.define("qrgen-barcode", QRGenBarcodeElement);
}

export { QRGenBarcodeElement, QRGenScannerElement };
