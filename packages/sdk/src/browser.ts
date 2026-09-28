// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0
// Standalone browser bundle (dist/browser/qrgen.js and qrgen.iife.js): everything in one file,
// custom elements registered on load. Exposed as the global `QRGen` in the IIFE build.
export * from "./index.js";
export { QRGenScannerElement, QRGenBarcodeElement, defineElements } from "./elements/define.js";
import { defineElements } from "./elements/define.js";
defineElements();
export { connectBridge, postToHost, parseBridgeMessage, attributesFromQuery, detectChannels } from "./bridge/index.js";
export { default } from "./index.js";
