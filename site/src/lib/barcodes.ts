// Build-time barcode rendering: pages embed real, scannable codes as inline SVG.
import { generate, type GenerateOptions } from "qrgen-sdk/node";

const cache = new Map<string, Promise<string>>();

export function barcodeSvg(data: string, options: GenerateOptions = {}): Promise<string> {
  const key = JSON.stringify([data, options]);
  let hit = cache.get(key);
  if (!hit) {
    hit = generate(data, { scale: 4, ...options }).then((r) => r.svg.replace("<svg ", '<svg preserveAspectRatio="xMidYMid meet" ').replace(/ width="[\d.]+" height="[\d.]+"/, ""));
    cache.set(key, hit);
  }
  return hit;
}
