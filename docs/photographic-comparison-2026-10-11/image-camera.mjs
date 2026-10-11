// Deterministic public image -> static fake-camera conversion; no decoder calls.
// Run from a checkout with sharp installed, or set QRGEN_COMPARISON_REPO.
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
const taskRequire = createRequire(join(process.env.QRGEN_COMPARISON_REPO ?? process.cwd(), "package.json"));
const sharp = taskRequire("sharp");
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
export async function writeImageCamera(outputPath, imagePath, { width = 640, height = 480, frames = 30 } = {}) {
  if (width % 2 || height % 2) throw new Error("YUV420 dimensions must be even");
  const original = readFileSync(imagePath);
  const metadata = await sharp(original).metadata();
  const { data, info } = await sharp(original).flatten({ background: "#ffffff" }).removeAlpha().toColourspace("srgb")
    .resize({ width, height, fit: "inside", withoutEnlargement: true, kernel: "lanczos3" }).raw().toBuffer({ resolveWithObject: true });
  if (info.channels !== 3) throw new Error("Expected RGB raster");
  const left = Math.floor((width - info.width) / 2), top = Math.floor((height - info.height) / 2);
  const y = Buffer.alloc(width * height, 200);
  for (let row = 0; row < info.height; row++) for (let column = 0; column < info.width; column++) {
    const i = (row * info.width + column) * 3;
    // BT.601 limited-range luma. Chroma is neutral to preserve a reproducible grayscale view.
    y[(row + top) * width + column + left] = Math.round(16 + (65.738 * data[i] + 129.057 * data[i + 1] + 25.064 * data[i + 2]) / 255);
  }
  const header = Buffer.from("YUV4MPEG2 W" + width + " H" + height + " F30:1 Ip A1:1 C420jpeg\n");
  const frame = Buffer.concat([Buffer.from("FRAME\n"), y, Buffer.alloc(width * height / 2, 128)]);
  const video = Buffer.concat([header, ...Array(frames).fill(frame)]);
  writeFileSync(outputPath, video);
  return { imageSha256: sha256(original), y4mSha256: sha256(video), sourceWidth: metadata.width, sourceHeight: metadata.height,
    width, height, frames, frameRate: "30:1", rasterWidth: info.width, rasterHeight: info.height, left, top,
    resized: info.width !== metadata.width || info.height !== metadata.height, resizeKernel: "lanczos3", noUpscaling: true,
    sourceAlphaComposite: "white", luma: "round(16 + (65.738*R + 129.057*G + 25.064*B)/255)", chroma: 128,
    paddingY: 200, sharpVersion: sharp.versions.sharp };
}
