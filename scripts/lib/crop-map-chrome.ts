import { readFileSync } from "fs";
import sharp from "sharp";

export interface MapChromeCrop {
  top: number;
  bottom: number;
  width: number;
  height: number;
}

/** Bottom crop = top crop × 1.2 (toolbar chrome is heavier at the bottom). */
export function bottomCropFromTop(topPx: number): number {
  return Math.round(topPx * 1.2);
}

/**
 * Detect crop on a fully merged panorama (scan across the stitched width).
 * Must run only after all tiles are composited — not on individual tiles.
 */
export async function detectMapChromeCropMerged(
  input: string | Buffer,
  opts: { blackThreshold?: number; minDarkRows?: number; darkFraction?: number } = {}
): Promise<MapChromeCrop> {
  const buf = typeof input === "string" ? readFileSync(input) : input;
  const meta = await sharp(buf).metadata();
  const w = meta.width ?? 1920;
  const h = meta.height ?? 1080;
  const blackThreshold = opts.blackThreshold ?? 72;
  const minDarkRows = opts.minDarkRows ?? 2;
  const darkFraction = opts.darkFraction ?? 0.45;

  const detectW = Math.min(1920, w);
  const scanW = Math.min(960, detectW);
  const scanH = Math.min(900, h);
  const { data, info } = await sharp(buf)
    .extract({ left: 0, top: 0, width: detectW, height: h })
    .resize(scanW, scanH, { fit: "fill" })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const sw = info.width;
  const sh = info.height;
  let top = 0;
  let darkRun = 0;

  for (let y = 0; y < sh; y++) {
    let dark = 0;
    for (let x = 0; x < sw; x++) {
      if (data[y * sw + x] < blackThreshold) dark++;
    }
    const frac = dark / sw;
    if (frac >= darkFraction) {
      darkRun++;
      if (darkRun >= minDarkRows) {
        top = Math.max(0, Math.round(((y - minDarkRows + 1) * h) / sh));
        break;
      }
    } else {
      darkRun = 0;
    }
  }

  const bottom = bottomCropFromTop(top);
  const height = Math.max(1, h - top - bottom);
  return { top, bottom, width: w, height };
}

/**
 * Detect crop on a single tile (for tests / single-frame use only).
 */
export async function detectMapChromeCrop(
  input: string | Buffer,
  opts: { blackThreshold?: number; minDarkRows?: number } = {}
): Promise<MapChromeCrop> {
  const buf = typeof input === "string" ? readFileSync(input) : input;
  const meta = await sharp(buf).metadata();
  const w = meta.width ?? 1920;
  const h = meta.height ?? 1080;
  const blackThreshold = opts.blackThreshold ?? 72;
  const minDarkRows = opts.minDarkRows ?? 2;

  const sampleW = Math.min(960, Math.round(w * 0.7));
  const { data, info } = await sharp(buf)
    .extract({
      left: Math.round(w * 0.15),
      top: 0,
      width: Math.round(w * 0.7),
      height: h,
    })
    .resize(sampleW)
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const sw = info.width;
  const sh = info.height;
  let top = 0;
  let darkRun = 0;

  for (let y = 0; y < sh; y++) {
    let sum = 0;
    for (let x = 0; x < sw; x++) sum += data[y * sw + x];
    const mean = sum / sw;
    if (mean < blackThreshold) {
      darkRun++;
      if (darkRun >= minDarkRows) {
        top = Math.max(0, Math.round(((y - minDarkRows + 1) * h) / sh));
        break;
      }
    } else {
      darkRun = 0;
    }
  }

  const bottom = bottomCropFromTop(top);
  const height = Math.max(1, h - top - bottom);
  return { top, bottom, width: w, height };
}

export async function cropMapChrome(input: Buffer, crop?: MapChromeCrop): Promise<Buffer> {
  const c = crop ?? (await detectMapChromeCrop(input));
  return sharp(input)
    .extract({ left: 0, top: c.top, width: c.width, height: c.height })
    .png()
    .toBuffer();
}
