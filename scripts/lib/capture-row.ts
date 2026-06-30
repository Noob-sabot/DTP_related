import { readFileSync } from "fs";
import sharp from "sharp";
import type { Page } from "@playwright/test";
import { scoreTranslatePlacement } from "./stitch-two.js";
import { getCanvasRegion, panCanvas } from "./figjam-capture.js";
import { timed } from "./timing.js";

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
  return timed("align.findTranslateOffset", async () => {
  const meta = await sharp(readFileSync(leftPath)).metadata();
  const tileWidth = meta.width ?? 1920;
  const scale = tileWidth > 2400 ? 1920 / tileWidth : 1;
  const sExpected = Math.round(expectedPan * scale);
  const sPanRadius = Math.max(8, Math.round(panRadius * scale));
  const sDyRadius = Math.max(4, Math.round(dyRadius * scale));
  const minPan = Math.round(80 * scale);
  const maxPan = Math.round((tileWidth - 80) * scale);

  let best = { pan: sExpected, dy: 0, score: -1 };
  for (let pan = sExpected - sPanRadius; pan <= sExpected + sPanRadius; pan += 2) {
    if (pan < minPan || pan > maxPan) continue;
    for (let dy = -sDyRadius; dy <= sDyRadius; dy += 2) {
      const score = await scoreTranslatePlacement(
        leftPath,
        rightPath,
        Math.round(pan / scale),
        Math.round(dy / scale)
      );
      if (score > best.score) best = { pan, dy, score };
    }
  }

  for (let pan = best.pan - 4; pan <= best.pan + 4; pan++) {
    if (pan < minPan || pan > maxPan) continue;
    for (let dy = best.dy - 4; dy <= best.dy + 4; dy++) {
      const score = await scoreTranslatePlacement(
        leftPath,
        rightPath,
        Math.round(pan / scale),
        Math.round(dy / scale)
      );
      if (score > best.score) best = { pan, dy, score };
    }
  }

  return {
    pan: Math.round(best.pan / scale),
    dy: Math.round(best.dy / scale),
    score: best.score,
  };
  });
}

async function leftStripMean(imagePath: string, stripWidth = 120): Promise<number> {
  const meta = await sharp(readFileSync(imagePath)).metadata();
  const w = meta.width ?? 1920;
  const h = meta.height ?? 1080;
  const stats = await sharp(readFileSync(imagePath))
    .extract({ left: 0, top: 0, width: Math.min(stripWidth, w), height: h })
    .stats();
  return stats.channels[0]?.mean ?? 255;
}

/** Pan left until the viewport hits the map's left edge, then nudge back one step if overshot. */
export async function seekMapLeftEdge(
  page: Page,
  stepX: number,
  settleMs: number,
  captureTo: (path: string) => Promise<void>,
  tmpPath: string,
  maxPans = 14
): Promise<void> {
  const region = await getCanvasRegion(page);
  let overshot = false;
  for (let i = 0; i < maxPans; i++) {
    await captureTo(tmpPath);
    const mean = await leftStripMean(tmpPath);
    if (mean > 242) {
      overshot = i > 0;
      break;
    }
    await panCanvas(page, region, -stepX, 0);
    await page.waitForTimeout(settleMs);
  }
  if (overshot) {
    await panCanvas(page, region, stepX, 0);
    await page.waitForTimeout(settleMs);
  }
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
  stepX: number,
  stepDy = 0
): Promise<RowEndCheck> {
  return timed("capture.detectRowEnd", async () => {
  const meta = await sharp(readFileSync(currPath)).metadata();
  const w = meta.width ?? 1920;
  const h = meta.height ?? 1080;
  const overlap = Math.max(80, w - stepX);
  const novelWidth = w - overlap;

  const overlapScore = await timed("capture.detectRowEnd.overlapScore", () =>
    scoreTranslatePlacement(prevPath, currPath, stepX, stepDy)
  );
  const similarity = await timed("capture.detectRowEnd.similarity", () =>
    fullImageSimilarity(prevPath, currPath)
  );

  let novelMean = 255;
  if (novelWidth > 40) {
    novelMean = await timed("capture.detectRowEnd.novelRegion", async () => {
      const stats = await sharp(readFileSync(currPath))
        .extract({ left: overlap, top: 0, width: novelWidth, height: h })
        .stats();
      return stats.channels[0]?.mean ?? 255;
    });
  }

  if (novelWidth > 40 && novelMean > 215) {
    return {
      stop: true,
      reason: `novel region mostly blank (mean grey ${novelMean.toFixed(0)})`,
      overlapScore,
      novelMean,
      similarity,
    };
  }

  if (similarity < 0.55 && novelMean > 200) {
    return {
      stop: true,
      reason: `past map edge (sim=${(similarity * 100).toFixed(0)}%, novel grey ${novelMean.toFixed(0)})`,
      overlapScore,
      novelMean,
      similarity,
    };
  }

  if (similarity > 0.965 && novelMean > 240) {
    return {
      stop: true,
      reason: `tiles ${(similarity * 100).toFixed(1)}% similar, novel region blank`,
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
  });
}
