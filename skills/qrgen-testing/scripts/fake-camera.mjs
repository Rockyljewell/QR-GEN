// Writes Y4M videos with barcodes painted in, for Chromium's fake camera
// (--use-file-for-fake-video-capture). Used by the end-to-end tests.
import { writeFileSync } from "node:fs";
import { generate } from "qrgen-sdk/node";

/**
 * @param {string} path output .y4m
 * @param {{ data: string, symbology: string, x: number, y: number, module: number, gs1?: boolean }[]} codes
 */
export async function writeFakeCamera(path, codes, { width = 640, height = 480, frames = 30 } = {}) {
  const Y = new Uint8Array(width * height).fill(200);
  for (const c of codes) {
    const g = await generate(c.data, { symbology: c.symbology, gs1: c.gs1, scale: 1 });
    const { width: mw, height: mh, modules } = g.matrix;
    // Linear codes come back with a 1-row matrix: stretch them vertically.
    const rows = mh === 1 ? 60 : mh * c.module;
    for (let yy = 0; yy < rows; yy++) {
      const my = mh === 1 ? 0 : Math.floor(yy / c.module);
      for (let xx = 0; xx < mw * c.module; xx++) {
        const mx = Math.floor(xx / c.module);
        const px = c.x + xx;
        const py = c.y + yy;
        if (px < 0 || py < 0 || px >= width || py >= height) continue;
        Y[py * width + px] = modules[my * mw + mx] ? 20 : 245;
      }
    }
  }
  const header = Buffer.from(`YUV4MPEG2 W${width} H${height} F30:1 Ip A1:1 C420jpeg\n`);
  const uv = Buffer.alloc((width / 2) * (height / 2) * 2, 128);
  const frame = Buffer.concat([Buffer.from("FRAME\n"), Buffer.from(Y), uv]);
  const parts = [header];
  for (let i = 0; i < frames; i++) parts.push(frame);
  writeFileSync(path, Buffer.concat(parts));
}
