import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";
import sharp from "sharp";
import { timed } from "./timing.js";

export interface TwoImageSeam {
  overlap: number;
  dy: number;
  score: number;
}

export interface StitchAlignOptions {
  /** Right image x offset on canvas (pixels panned right between captures). */
  pan?: number;
  /** Vertical offset: positive moves the right image down. */
  dy?: number;
  /** Preview only: right-image opacity 0–1 (default 0.45). */
  alpha?: number;
}

export interface AlignmentGuess {
  pan: number;
  overlap: number;
  dy: number;
  score: number;
  confident: boolean;
  note: string;
}

const CONFIDENCE_MIN_SCORE = 0.88;
const CONFIDENCE_MAX_PAN_SPREAD = 40;

export interface StitchTwoResult {
  buffer: Buffer;
  overlap: number;
  verticalShift: number;
  score: number;
  width: number;
  height: number;
}

interface GrayImage {
  data: Uint8Array;
  w: number;
  h: number;
}

const CONTENT_TOP = 60;

async function loadGray(buffer: Buffer, scale = 1): Promise<GrayImage> {
  let img = sharp(buffer);
  const meta = await img.metadata();
  const w0 = meta.width ?? 1920;
  const h0 = meta.height ?? 1080;
  const w = scale < 1 ? Math.round(w0 * scale) : w0;
  const h = scale < 1 ? Math.round(h0 * scale) : h0;
  if (scale < 1) img = img.resize(w, h, { fit: "fill" });
  const { data } = await img.greyscale().raw().toBuffer({ resolveWithObject: true });
  return { data, w, h };
}

function region(g: GrayImage, x: number, y: number, w: number, h: number): Uint8Array | null {
  if (x < 0 || y < 0 || x + w > g.w || y + h > g.h) return null;
  const out = new Uint8Array(w * h);
  for (let row = 0; row < h; row++) {
    out.set(g.data.subarray((y + row) * g.w + x, (y + row) * g.w + x + w), row * w);
  }
  return out;
}

function variance(data: Uint8Array): number {
  if (!data.length) return 0;
  let sum = 0;
  for (const v of data) sum += v;
  const mean = sum / data.length;
  let v = 0;
  for (const x of data) {
    const d = x - mean;
    v += d * d;
  }
  return v / data.length;
}

function ncc(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length);
  if (!n) return -1;
  let sa = 0,
    sb = 0;
  for (let i = 0; i < n; i++) {
    sa += a[i];
    sb += b[i];
  }
  const ma = sa / n,
    mb = sb / n;
  let num = 0,
    da = 0,
    db = 0;
  for (let i = 0; i < n; i++) {
    const xa = a[i] - ma,
      xb = b[i] - mb;
    num += xa * xb;
    da += xa * xa;
    db += xb * xb;
  }
  const den = Math.sqrt(da * db);
  return den > 1e-6 ? num / den : -1;
}

function patchVariance(g: GrayImage, px: number, py: number, pw: number, ph: number): number {
  let sum = 0,
    n = 0;
  for (let y = 0; y < ph; y++) {
    for (let x = 0; x < pw; x++) {
      sum += g.data[(py + y) * g.w + px + x];
      n++;
    }
  }
  const mean = sum / n;
  let v = 0;
  for (let y = 0; y < ph; y++) {
    for (let x = 0; x < pw; x++) {
      const d = g.data[(py + y) * g.w + px + x] - mean;
      v += d * d;
    }
  }
  return v / n;
}

function matchPatchNcc(
  left: GrayImage,
  right: GrayImage,
  px: number,
  py: number,
  pw: number,
  ph: number,
  rx: number,
  dy: number
): number {
  let n = 0,
    sa = 0,
    sb = 0;
  for (let y = 0; y < ph; y++) {
    for (let x = 0; x < pw; x++) {
      const ly = py + y;
      const ry = py + dy + y;
      if (ry < 0 || ry >= left.h) continue;
      sa += left.data[ly * left.w + px + x];
      sb += right.data[ry * right.w + rx + x];
      n++;
    }
  }
  if (n < pw * ph * 0.9) return -1;
  const ma = sa / n,
    mb = sb / n;
  let num = 0,
    da = 0,
    db = 0;
  for (let y = 0; y < ph; y++) {
    for (let x = 0; x < pw; x++) {
      const ly = py + y;
      const ry = py + dy + y;
      if (ry < 0 || ry >= left.h) continue;
      const xa = left.data[ly * left.w + px + x] - ma;
      const xb = right.data[ry * right.w + rx + x] - mb;
      num += xa * xb;
      da += xa * xa;
      db += xb * xb;
    }
  }
  const den = Math.sqrt(da * db);
  return den > 1e-6 ? num / den : -1;
}

/** Horizontal pan: content at left x appears at right x - pan. overlap = width - pan. */
function findHorizontalPan(left: GrayImage, right: GrayImage): { pan: number; pans: number[] } {
  const pw = 120;
  const ph = 80;
  const py = CONTENT_TOP + 160;
  const minPan = 120;
  const maxPan = left.w - 80;

  const candidates: { px: number; variance: number }[] = [];
  for (let px = Math.round(left.w * 0.28); px <= Math.round(left.w * 0.72); px += 80) {
    candidates.push({ px, variance: patchVariance(left, px, py, pw, ph) });
  }
  candidates.sort((a, b) => b.variance - a.variance);
  const patches = candidates.slice(0, 3);

  const pans: number[] = [];
  for (const { px } of patches) {
    let best = { pan: minPan, score: -1 };
    for (let rx = 0; rx <= right.w - pw; rx += 2) {
      const pan = rx - px;
      if (pan < minPan || pan > maxPan) continue;
      const score = matchPatchNcc(left, right, px, py, pw, ph, rx, 0);
      if (score > best.score) best = { pan, score };
    }
    if (best.score > 0.85) pans.push(best.pan);
  }

  if (!pans.length) {
    return { pan: Math.round(left.w * 0.37), pans: [] };
  }
  pans.sort((a, b) => a - b);
  let pan = pans[Math.floor(pans.length / 2)];

  let bestSeam = { pan, score: -1 };
  for (let p = pan - 40; p <= pan + 40; p += 2) {
    if (p < minPan || p > maxPan) continue;
    const overlap = left.w - p;
    const score = seamScoreGray(left, right, overlap, 0);
    if (score > bestSeam.score) bestSeam = { pan: p, score };
  }
  return { pan: bestSeam.pan, pans };
}

function seamScoreGray(left: GrayImage, right: GrayImage, overlap: number, dy: number): number {
  const stripH = Math.max(20, Math.round(left.h * 0.07));
  let total = 0,
    weight = 0;
  for (let y = 40; y < left.h - stripH - 40; y += Math.max(24, Math.round(stripH * 0.7))) {
    const a = region(left, left.w - overlap, y, overlap, stripH);
    const b = region(right, 0, y + dy, overlap, stripH);
    if (!a || !b) continue;
    const v = Math.min(variance(a), variance(b));
    if (v < 50) continue;
    total += ncc(a, b) * v;
    weight += v;
  }
  return weight > 0 ? total / weight : -1;
}

/**
 * First-principles translate placement score.
 * Left at (0,0), right at (pan, dy): overlap columns [pan..w] vs [0..w-pan],
 * same row y on left vs row y-dy on right.
 */
export async function scoreTranslatePlacement(
  leftPath: string,
  rightPath: string,
  pan: number,
  dy: number,
  analysisMaxWidth = 1920
): Promise<number> {
  return timed("align.scoreTranslatePlacement", async () => {
  const left = readFileSync(leftPath);
  const right = readFileSync(rightPath);
  const meta = await sharp(left).metadata();
  const tileWidth = meta.width ?? 1920;
  const scale = tileWidth > analysisMaxWidth ? analysisMaxWidth / tileWidth : 1;
  const sPan = Math.round(pan * scale);
  const sDy = Math.round(dy * scale);
  const leftF = await loadGray(left, scale);
  const rightF = await loadGray(right, scale);

  const overlap = leftF.w - sPan;
  if (overlap < 40 || sPan < 0) return -1;

  const stripH = Math.max(20, Math.round(leftF.h * 0.07));
  let total = 0,
    weight = 0;

  for (let y = 40; y < leftF.h - stripH - 40; y += Math.max(24, Math.round(stripH * 0.7))) {
    const ry = y - sDy;
    if (ry < 0 || ry + stripH > rightF.h) continue;
    const a = region(leftF, sPan, y, overlap, stripH);
    const b = region(rightF, 0, ry, overlap, stripH);
    if (!a || !b) continue;
    const v = Math.min(variance(a), variance(b));
    if (v < 50) continue;
    total += ncc(a, b) * v;
    weight += v;
  }
  return weight > 0 ? total / weight : -1;
  });
}

export interface MicroSnapResult {
  pan: number;
  dy: number;
  score: number;
  userScore: number;
  improved: boolean;
}

/** Try snap: lock pan, nudge dy only using translate semantics. */
export async function microSnapTranslate(
  leftPath: string,
  rightPath: string,
  userPan: number,
  userDy: number,
  maxDy = 8
): Promise<MicroSnapResult> {
  const userScore = await scoreTranslatePlacement(leftPath, rightPath, userPan, userDy);
  let best = { pan: userPan, dy: userDy, score: userScore };

  for (let d = userDy - maxDy; d <= userDy + maxDy; d++) {
    const score = await scoreTranslatePlacement(leftPath, rightPath, userPan, d);
    if (score > best.score) best = { pan: userPan, dy: d, score };
  }

  const improved = best.score > userScore + 0.002;
  return {
    pan: improved ? best.pan : userPan,
    dy: improved ? best.dy : userDy,
    score: improved ? best.score : userScore,
    userScore,
    improved,
  };
}

export async function guessAlignment(
  leftPath: string,
  rightPath: string
): Promise<AlignmentGuess> {
  const left = readFileSync(leftPath);
  const right = readFileSync(rightPath);
  const meta = await sharp(left).metadata();
  const tileWidth = meta.width ?? 1920;
  const seam = await findTwoImageSeam(left, right, tileWidth, meta.height ?? 1080);
  const pan = tileWidth - seam.overlap;

  const leftF = await loadGray(left, 1);
  const rightF = await loadGray(right, 1);
  const { pans } = findHorizontalPan(leftF, rightF);
  const panSpread = pans.length > 1 ? pans[pans.length - 1] - pans[0] : 0;

  let confident = seam.score >= CONFIDENCE_MIN_SCORE && panSpread <= CONFIDENCE_MAX_PAN_SPREAD;
  let note = confident
    ? "Alignment guess looks plausible — still verify with align-preview."
    : `Auto-alignment unreliable (score=${seam.score.toFixed(3)}, pan spread=${panSpread}px). Use align-preview and set --pan/--dy manually.`;

  return { pan, overlap: seam.overlap, dy: seam.dy, score: seam.score, confident, note };
}

export async function findTwoImageSeam(
  leftBuf: Buffer,
  rightBuf: Buffer,
  tileWidth: number,
  _tileHeight: number,
  quiet = false
): Promise<TwoImageSeam> {
  const leftF = await loadGray(leftBuf, 1);
  const rightF = await loadGray(rightBuf, 1);

  const { pan } = findHorizontalPan(leftF, rightF);
  let refineO = tileWidth - pan;
  refineO = Math.max(80, Math.min(tileWidth - 80, refineO));

  if (!quiet) console.log(`  horizontal pan=${pan}px  overlap=${refineO}px`);

  let bestDy = 0;
  let dyScore = -1;
  for (let dy = -80; dy <= 80; dy++) {
    const score = seamScoreGray(leftF, rightF, refineO, dy);
    if (score > dyScore) {
      dyScore = score;
      bestDy = dy;
    }
  }

  if (!quiet) console.log(`  best dy=${bestDy}px  score=${dyScore.toFixed(3)}`);

  return { overlap: refineO, dy: bestDy, score: dyScore };
}

/** Refine pan/dy in a window around a manual placement. */
export async function refineAlignmentNear(
  leftPath: string,
  rightPath: string,
  hintPan: number,
  hintDy: number,
  panRadius = 120,
  dyRadius = 60
): Promise<{ pan: number; dy: number; score: number }> {
  const left = readFileSync(leftPath);
  const right = readFileSync(rightPath);
  const meta = await sharp(left).metadata();
  const tileWidth = meta.width ?? 1920;
  const leftF = await loadGray(left, 1);
  const rightF = await loadGray(right, 1);

  const minPan = 80;
  const maxPan = tileWidth - 80;
  const overlap = tileWidth - hintPan;
  const seedScore =
    hintPan >= minPan && hintPan <= maxPan
      ? seamScoreGray(leftF, rightF, overlap, hintDy)
      : -1;

  function search(
    centerPan: number,
    centerDy: number,
    rPan: number,
    rDy: number,
    step: number,
    seed: { pan: number; dy: number; score: number }
  ) {
    let best = seed;
    for (let pan = centerPan - rPan; pan <= centerPan + rPan; pan += step) {
      if (pan < minPan || pan > maxPan) continue;
      const o = tileWidth - pan;
      for (let d = centerDy - rDy; d <= centerDy + rDy; d += step) {
        const score = seamScoreGray(leftF, rightF, o, d);
        if (score > best.score) best = { pan, dy: d, score };
      }
    }
    return best;
  }

  const seed = { pan: hintPan, dy: hintDy, score: seedScore };
  const coarse = search(hintPan, hintDy, panRadius, dyRadius, 8, seed);
  return search(coarse.pan, coarse.dy, 16, 12, 2, coarse);
}

/** Full auto snap or refine around current placement. */
export async function snapAlignment(
  leftPath: string,
  rightPath: string,
  mode: "guess" | "refine",
  hint?: { pan: number; dy: number }
): Promise<{ pan: number; dy: number; score: number }> {
  if (mode === "guess") {
    const guess = await guessAlignment(leftPath, rightPath);
    return { pan: guess.pan, dy: guess.dy, score: guess.score };
  }
  const pan = hint?.pan ?? 0;
  const dy = hint?.dy ?? 0;
  return refineAlignmentNear(leftPath, rightPath, pan, dy);
}

async function fadeToAlpha(buffer: Buffer, alpha: number): Promise<Buffer> {
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const px = new Uint8Array(data);
  for (let i = 3; i < px.length; i += 4) px[i] = Math.round(px[i] * alpha);
  return sharp(px, { raw: { width: info.width, height: info.height, channels: 4 } })
    .png()
    .toBuffer();
}

/** Semi-transparent right image over left — for eyeballing pan/dy. */
export async function buildAlignPreview(
  leftPath: string,
  rightPath: string,
  options: StitchAlignOptions = {}
): Promise<StitchTwoResult> {
  const left = readFileSync(leftPath);
  const right = readFileSync(rightPath);
  const meta = await sharp(left).metadata();
  const tileWidth = meta.width ?? 1920;
  const tileHeight = meta.height ?? 1080;

  let pan = options.pan;
  let dy = options.dy ?? 0;
  let score = 0;

  if (pan === undefined) {
    const seam = await findTwoImageSeam(left, right, tileWidth, tileHeight, true);
    pan = tileWidth - seam.overlap;
    if (options.dy === undefined) dy = seam.dy;
    score = seam.score;
  }

  const alpha = options.alpha ?? 0.45;
  const bounds = placementBounds(tileWidth, tileHeight, pan, dy);
  const fadedRight = await fadeToAlpha(right, alpha);

  const buffer = await sharp({
    create: {
      width: bounds.width,
      height: bounds.height,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    },
  })
    .composite([
      { input: left, left: bounds.leftX, top: bounds.leftY },
      { input: fadedRight, left: bounds.rightX, top: bounds.rightY },
    ])
    .png()
    .toBuffer();

  return {
    buffer,
    overlap: tileWidth - pan,
    verticalShift: dy,
    score,
    width: bounds.width,
    height: bounds.height,
  };
}

export async function writeAlignPreview(
  leftPath: string,
  rightPath: string,
  outPath: string,
  options: StitchAlignOptions = {}
): Promise<StitchTwoResult> {
  const result = await buildAlignPreview(leftPath, rightPath, options);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, result.buffer);
  return result;
}

/** Composite with right offset (pan, dy) from left top-left; crop to union bounds. */
export function placementBounds(
  tileWidth: number,
  tileHeight: number,
  pan: number,
  dy: number
): {
  width: number;
  height: number;
  leftX: number;
  leftY: number;
  rightX: number;
  rightY: number;
} {
  const x0 = Math.min(0, pan);
  const y0 = Math.min(0, dy);
  const x1 = Math.max(tileWidth, pan + tileWidth);
  const y1 = Math.max(tileHeight, dy + tileHeight);
  return {
    width: x1 - x0,
    height: y1 - y0,
    leftX: -x0,
    leftY: -y0,
    rightX: pan - x0,
    rightY: dy - y0,
  };
}

/** Place full tiles with horizontal pan; right overlays left in the overlap. */
export async function stitchTwoImages(
  leftPath: string,
  rightPath: string,
  options: StitchAlignOptions = {}
): Promise<StitchTwoResult> {
  const left = readFileSync(leftPath);
  const right = readFileSync(rightPath);
  const meta = await sharp(left).metadata();
  const tileWidth = meta.width ?? 1920;
  const tileHeight = meta.height ?? 1080;

  let pan = options.pan;
  let dy = options.dy ?? 0;
  let score = 1;

  if (pan === undefined) {
    console.log("  Finding seam alignment...");
    const seam = await findTwoImageSeam(left, right, tileWidth, tileHeight);
    pan = tileWidth - seam.overlap;
    if (options.dy === undefined) dy = seam.dy;
    score = seam.score;
  }

  const overlap = tileWidth - pan;
  console.log(`  pan=${pan}px  overlap=${overlap}px  dy=${dy}px`);

  const bounds = placementBounds(tileWidth, tileHeight, pan, dy);

  const buffer = await sharp({
    create: {
      width: bounds.width,
      height: bounds.height,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    },
  })
    .composite([
      { input: left, left: bounds.leftX, top: bounds.leftY },
      { input: right, left: bounds.rightX, top: bounds.rightY },
    ])
    .png()
    .toBuffer();

  return {
    buffer,
    overlap,
    verticalShift: dy,
    score,
    width: bounds.width,
    height: bounds.height,
  };
}

export interface WriteStitchOptions {
  align?: StitchAlignOptions;
  /** Stitch even when auto-align confidence is low. */
  force?: boolean;
}

export async function writeStitchTwo(
  leftPath: string,
  rightPath: string,
  outPath: string,
  options: WriteStitchOptions = {}
): Promise<StitchTwoResult> {
  const manual = options.align?.pan !== undefined;
  if (!manual && !options.force) {
    const guess = await guessAlignment(leftPath, rightPath);
    if (!guess.confident) {
      const previewPath = outPath.replace(/\.png$/i, "") + "-needs-review.png";
      await writeAlignPreview(leftPath, rightPath, previewPath, {
        pan: guess.pan,
        dy: guess.dy,
        alpha: 0.45,
      });
      throw new Error(
        `${guess.note}\n` +
          `  Wrote semi-transparent preview: ${previewPath}\n` +
          `  Tune: npm run stitch:preview -- <left> <right> --pan N --dy N\n` +
          `  Then: npm run stitch:two -- <left> <right> <out> --pan N --dy N`
      );
    }
  }

  const result = await stitchTwoImages(leftPath, rightPath, options.align);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, result.buffer);
  return result;
}
