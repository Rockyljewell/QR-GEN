import { defineElements } from "./define.js";

export { defineElements, QRGenBarcodeElement, QRGenScannerElement } from "./define.js";
export type { ScannerState } from "../scanner.js";

// Importing "qrgen-sdk/elements" registers the elements (this file must stay an entry-only module).
defineElements();

declare global {
  interface HTMLElementTagNameMap {
    "qrgen-scanner": import("./scanner-element.js").QRGenScannerElement;
    "qrgen-barcode": import("./barcode-element.js").QRGenBarcodeElement;
  }
}
