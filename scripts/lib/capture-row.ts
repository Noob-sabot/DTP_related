import { readFileSync } from "fs";
import sharp from "sharp";
import { scoreTranslatePlacement } from "./stitch-two.js";

export const MAX_ROW_TILES = 15;

export interface RowEndCheck {
  stop: boolean;
  reason: string;
  overlapScore: number;
  novelMean: number;
  similarity: number;
}

/** Find best translate offset of right relative to left (consecutive captures). */
export async function findTranslateOffset(
  leftPath: string,
  rightPath: string,
  expectedPan: number,
  panRadius = 100,
  dyRadius = 24
): Promise<{ pan: number; dy: number; score: number }> {
  const meta = await sharp(readFileSync(leftPath)).metadata();
  const tileWidth = meta.width ?? 1920;
  const minPan = 80;
  const maxPan = tileWidth - 80;

  let best = { pan: expectedPan, dy: 0, score: -1 };
  for (let pan = expectedPan - panRadius; pan <= expectedPan + panRadius; pan += 2) {
    if (pan < minPan || pan > maxPan) continue;
    for (let dy = -dyRadius; dy <= dyRadius; dy += 2) {
      const score = await scoreTranslatePlacement(leftPath, rightPath, pan, dy);
      if (score > best.score) best = { pan, dy, score };
    }
  }

  // fine pass
  for (let pan = best.pan - 4; pan <= best.pan + 4; pan++) {
    if (pan < minPan || pan > maxPan) continue;
    for (let dy = best.dy - 4; dy <= best.dy + 4; dy++) {
      const score = await scoreTranslatePlacement(leftPath, rightPath, pan, dy);
      if (score > best.score) best = { pan, dy, score };
    }
  }
  return best;
}

async function fullImageSimilarity(pathA: string, pathB: string): Promise<number> {
  const scale = 320;
  const load = async (p: string) => {
    const { data, info } = await sharp(readFileSync(p))
      .resize(scale)
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true });
    return { data, n: info.width * info.height };
  };
  const a = await load(pathA);
  const b = await load(pathB);
  const n = Math.min(a.n, b.n);
  let sa = 0,
    sb = 0;
  for (let i = 0; i < n; i++) {
    sa += a.data[i];
    sb += b.data[i];
  }
  const ma = sa / n,
    mb = sb / n;
  let num = 0,
    da = 0,
    db = 0;
  for (let i = 0; i < n; i++) {
    const xa = a.data[i] - ma,
      xb = b.data[i] - mb;
    num += xa * xb;
    da += xa * xa;
    db += xb * xb;
  }
  return num / Math.sqrt(da * db);
}

/**
 * Stop when the new tile has little novel content (blank canvas) or
 * looks almost identical to the previous tile after panning.
 */
export async function detectRowEnd(
  prevPath: string,
  currPath: string,
  stepX: number
): Promise<RowEndCheck> {
  const meta = await sharp(readFileSync(currPath)).metadata();
  const w = meta.width ?? 1920;
  const h = meta.height ?? 1080;
  const overlap = Math.max(80, w - stepX);
  const novelWidth = w - overlap;

  const overlapScore = await scoreTranslatePlacement(prevPath, currPath, stepX, 0);
  const similarity = await fullImageSimilarity(prevPath, currPath);

  let novelMean = 255;
  if (novelWidth > 40) {
    const stats = await sharp(readFileSync(currPath))
      .extract({ left: overlap, top: 0, width: novelWidth, height: h })
      .stats();
    novelMean = stats.channels[0]?.mean ?? 255;
  }

  if (similarity > 0.965) {
    return {
      stop: true,
      reason: `tiles ${(similarity * 100).toFixed(1)}% similar after pan — no new content`,
      overlapScore,
      novelMean,
      similarity,
    };
  }

  if (novelWidth > 40 && novelMean > 247) {
    return {
      stop: true,
      reason: `novel region mostly blank (mean grey ${novelMean.toFixed(0)})`,
      overlapScore,
      novelMean,
      similarity,
    };
  }

  if (overlapScore < 0.45) {
    return {
      stop: true,
      reason: `overlap score too low (${overlapScore.toFixed(3)}) — past map edge`,
      overlapScore,
      novelMean,
      similarity,
    };
  }

  return {
    stop: false,
    reason: "continuing",
    overlapScore,
    novelMean,
    similarity,
  };
}
