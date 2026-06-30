import sharp from "sharp";
import type { Tile } from "./stitch-tiles.js";

export interface AlignOptions {
  minOverlap?: number;
  maxOverlap?: number;
  stripHeight?: number;
  refineRadius?: number;
  /** Minimum pixel variance in a strip (rejects blank canvas margins). */
  minVariance?: number;
  /** Minimum NCC score to accept (0–1). */
  minNcc?: number;
  verticalShiftSearch?: number;
}

export interface TilePosition {
  x: number;
  y: number;
}

export interface AlignmentResult {
  overlap: number;
  score: number;
  verticalShift?: number;
}

const DEFAULT_ALIGN: Required<AlignOptions> = {
  minOverlap: 200,
  maxOverlap: 1100,
  stripHeight: 140,
  refineRadius: 6,
  minVariance: 400,
  minNcc: 0.35,
  verticalShiftSearch: 24,
};

async function grayStrip(
  buffer: Buffer,
  x: number,
  y: number,
  w: number,
  h: number
): Promise<Uint8Array> {
  const meta = await sharp(buffer).metadata();
  const iw = meta.width ?? 0;
  const ih = meta.height ?? 0;
  const left = Math.max(0, Math.min(x, iw - 1));
  const top = Math.max(0, Math.min(y, ih - 1));
  const width = Math.max(1, Math.min(w, iw - left));
  const height = Math.max(1, Math.min(h, ih - top));

  const { data } = await sharp(buffer)
    .extract({ left, top, width, height })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return data;
}

function variance(data: Uint8Array): number {
  if (data.length === 0) return 0;
  let sum = 0;
  for (const v of data) sum += v;
  const mean = sum / data.length;
  let varSum = 0;
  for (const v of data) {
    const d = v - mean;
    varSum += d * d;
  }
  return varSum / data.length;
}

function ncc(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return -1;

  let sumA = 0;
  let sumB = 0;
  for (let i = 0; i < n; i++) {
    sumA += a[i];
    sumB += b[i];
  }
  const meanA = sumA / n;
  const meanB = sumB / n;

  let num = 0;
  let denA = 0;
  let denB = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    num += da * db;
    denA += da * da;
    denB += db * db;
  }
  const den = Math.sqrt(denA * denB);
  return den > 1e-6 ? num / den : -1;
}

function stripYs(imageHeight: number, stripHeight: number): number[] {
  const h = Math.min(stripHeight, imageHeight - 4);
  const maxY = imageHeight - h;
  if (maxY <= 0) return [0];
  return [Math.floor(maxY * 0.32), Math.floor(maxY * 0.5), Math.floor(maxY * 0.68)];
}

async function horizontalPairScore(
  left: Buffer,
  right: Buffer,
  width: number,
  height: number,
  overlap: number,
  stripHeight: number,
  dy: number,
  minVariance: number
): Promise<number> {
  const h = Math.min(stripHeight, height - 4);
  let total = 0;
  let count = 0;

  for (const y of stripYs(height, h)) {
    const leftStrip = await grayStrip(left, width - overlap, y, overlap, h);
    const rightStrip = await grayStrip(right, 0, y + dy, overlap, h);
    if (leftStrip.length !== rightStrip.length) continue;

    const v = Math.min(variance(leftStrip), variance(rightStrip));
    if (v < minVariance) continue;

    total += ncc(leftStrip, rightStrip);
    count++;
  }

  return count > 0 ? total / count : -1;
}

async function verticalPairScore(
  top: Buffer,
  bottom: Buffer,
  width: number,
  height: number,
  overlap: number,
  minVariance: number
): Promise<number> {
  const stripWidth = Math.min(500, width - 20);
  const xs = [
    Math.floor((width - stripWidth) * 0.25),
    Math.floor((width - stripWidth) * 0.5),
    Math.floor((width - stripWidth) * 0.75),
  ];
  let total = 0;
  let count = 0;

  for (const x of xs) {
    const topStrip = await grayStrip(top, x, height - overlap, stripWidth, overlap);
    const bottomStrip = await grayStrip(bottom, x, 0, stripWidth, overlap);
    if (topStrip.length !== bottomStrip.length) continue;

    const v = Math.min(variance(topStrip), variance(bottomStrip));
    if (v < minVariance) continue;

    total += ncc(topStrip, bottomStrip);
    count++;
  }

  return count > 0 ? total / count : -1;
}

async function searchHorizontal(
  left: Buffer,
  right: Buffer,
  tileWidth: number,
  tileHeight: number,
  opts: Required<AlignOptions>
): Promise<AlignmentResult> {
  // Coarse search on downscaled images for speed, then refine at full resolution.
  const scale = tileWidth > 800 ? 480 / tileWidth : 1;
  const sw = Math.round(tileWidth * scale);
  const sh = Math.round(tileHeight * scale);

  const leftS =
    scale < 1
      ? await sharp(left).resize(sw, sh, { fit: "fill" }).png().toBuffer()
      : left;
  const rightS =
    scale < 1
      ? await sharp(right).resize(sw, sh, { fit: "fill" }).png().toBuffer()
      : right;

  const minO = Math.round(opts.minOverlap * scale);
  const maxO = Math.min(Math.round(opts.maxOverlap * scale), sw - 20);

  let best = Math.round(opts.minOverlap);
  let bestScore = -1;
  let bestDy = 0;

  for (let overlap = minO; overlap <= maxO; overlap += Math.max(4, Math.round(6 * scale))) {
    for (let dy = -opts.verticalShiftSearch; dy <= opts.verticalShiftSearch; dy += 8) {
      const dyS = Math.round(dy * scale);
      const score = await horizontalPairScore(
        leftS,
        rightS,
        sw,
        sh,
        overlap,
        Math.round(opts.stripHeight * scale),
        dyS,
        opts.minVariance * scale * scale * 0.5
      );
      const overlapFull = Math.round(overlap / scale);
      const tiebreak = score + overlapFull / 10000;
      const bestTie = bestScore + best / 10000;
      if (tiebreak > bestTie) {
        bestScore = score;
        best = overlapFull;
        bestDy = dy;
      }
    }
  }

  const lo = Math.max(opts.minOverlap, best - opts.refineRadius * 2);
  const hi = Math.min(opts.maxOverlap, Math.min(opts.maxOverlap, tileWidth - 40), best + opts.refineRadius * 2);
  for (let overlap = lo; overlap <= hi; overlap++) {
    for (let dy = -opts.verticalShiftSearch; dy <= opts.verticalShiftSearch; dy += 2) {
      const score = await horizontalPairScore(
        left,
        right,
        tileWidth,
        tileHeight,
        overlap,
        opts.stripHeight,
        dy,
        opts.minVariance
      );
      const tiebreak = score + overlap / 10000;
      const bestTie = bestScore + best / 10000;
      if (tiebreak > bestTie) {
        bestScore = score;
        best = overlap;
        bestDy = dy;
      }
    }
  }

  return { overlap: best, score: bestScore, verticalShift: bestDy };
}

async function searchVertical(
  top: Buffer,
  bottom: Buffer,
  tileWidth: number,
  tileHeight: number,
  opts: Required<AlignOptions>
): Promise<AlignmentResult> {
  const scale = tileHeight > 600 ? 540 / tileHeight : 1;
  const sw = Math.round(tileWidth * scale);
  const sh = Math.round(tileHeight * scale);

  const topS =
    scale < 1 ? await sharp(top).resize(sw, sh, { fit: "fill" }).png().toBuffer() : top;
  const bottomS =
    scale < 1 ? await sharp(bottom).resize(sw, sh, { fit: "fill" }).png().toBuffer() : bottom;

  const minO = Math.round(opts.minOverlap * scale);
  const maxO = Math.min(Math.round(opts.maxOverlap * scale), sh - 20);

  let best = Math.round(opts.minOverlap);
  let bestScore = -1;

  for (let overlap = minO; overlap <= maxO; overlap += Math.max(4, Math.round(6 * scale))) {
    const score = await verticalPairScore(
      topS,
      bottomS,
      sw,
      sh,
      overlap,
      opts.minVariance * scale * scale * 0.5
    );
    const overlapFull = Math.round(overlap / scale);
    const tiebreak = score + overlapFull / 10000;
    const bestTie = bestScore + best / 10000;
    if (tiebreak > bestTie) {
      bestScore = score;
      best = overlapFull;
    }
  }

  const lo = Math.max(opts.minOverlap, best - opts.refineRadius * 2);
  const hi = Math.min(opts.maxOverlap, tileHeight - 40, best + opts.refineRadius * 2);
  for (let overlap = lo; overlap <= hi; overlap++) {
    const score = await verticalPairScore(top, bottom, tileWidth, tileHeight, overlap, opts.minVariance);
    const tiebreak = score + overlap / 10000;
    const bestTie = bestScore + best / 10000;
    if (tiebreak > bestTie) {
      bestScore = score;
      best = overlap;
    }
  }

  return { overlap: best, score: bestScore };
}

export async function findHorizontalOverlap(
  left: Buffer,
  right: Buffer,
  tileWidth: number,
  tileHeight: number,
  opts: AlignOptions = {}
): Promise<AlignmentResult> {
  return searchHorizontal(left, right, tileWidth, tileHeight, { ...DEFAULT_ALIGN, ...opts });
}

export async function findVerticalOverlap(
  top: Buffer,
  bottom: Buffer,
  tileWidth: number,
  tileHeight: number,
  opts: AlignOptions = {}
): Promise<AlignmentResult> {
  return searchVertical(top, bottom, tileWidth, tileHeight, { ...DEFAULT_ALIGN, ...opts });
}

export interface GridAlignment {
  positions: TilePosition[][];
  horizontalOverlaps: number[][];
  verticalOverlaps: number[][];
  verticalShifts: number[][];
}

export async function computeAlignedPositions(
  grid: (Tile | null)[][],
  tileWidth: number,
  tileHeight: number,
  opts: AlignOptions = {}
): Promise<GridAlignment> {
  const o = { ...DEFAULT_ALIGN, ...opts };
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  const positions: TilePosition[][] = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => ({ x: 0, y: 0 }))
  );
  const horizontalOverlaps: number[][] = Array.from({ length: rows }, () => Array(cols).fill(0));
  const verticalOverlaps: number[][] = Array.from({ length: rows }, () => Array(cols).fill(0));
  const verticalShifts: number[][] = Array.from({ length: rows }, () => Array(cols).fill(0));

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const tile = grid[row][col];
      if (!tile) continue;

      if (row === 0 && col === 0) {
        positions[row][col] = { x: 0, y: 0 };
        continue;
      }

      if (col === 0) {
        const above = grid[row - 1][col];
        if (!above) continue;
        const { overlap, score } = await findVerticalOverlap(
          above.buffer,
          tile.buffer,
          tileWidth,
          tileHeight,
          o
        );
        verticalOverlaps[row][col] = overlap;
        if (score < o.minNcc) {
          console.warn(`  row ${row} weak vertical align (ncc=${score.toFixed(2)}, overlap=${overlap}px)`);
        }
        positions[row][col] = {
          x: positions[row - 1][col].x,
          y: positions[row - 1][col].y + tileHeight - overlap,
        };
      } else {
        const left = grid[row][col - 1];
        if (!left) continue;
        const { overlap, score, verticalShift = 0 } = await findHorizontalOverlap(
          left.buffer,
          tile.buffer,
          tileWidth,
          tileHeight,
          o
        );
        horizontalOverlaps[row][col] = overlap;
        verticalShifts[row][col] = verticalShift;
        if (score < o.minNcc) {
          console.warn(`  r${row}c${col} weak horizontal align (ncc=${score.toFixed(2)}, overlap=${overlap}px)`);
        }
        positions[row][col] = {
          x: positions[row][col - 1].x + tileWidth - overlap,
          y: positions[row][col - 1].y + verticalShift,
        };
      }
    }
  }

  return { positions, horizontalOverlaps, verticalOverlaps, verticalShifts };
}

export async function stitchAlignedGrid(
  grid: (Tile | null)[][],
  positions: TilePosition[][],
  tileWidth: number,
  tileHeight: number
): Promise<Buffer> {
  let maxX = 0;
  let maxY = 0;

  for (let row = 0; row < grid.length; row++) {
    for (let col = 0; col < (grid[row]?.length ?? 0); col++) {
      const tile = grid[row][col];
      if (!tile) continue;
      const pos = positions[row][col];
      maxX = Math.max(maxX, pos.x + tileWidth);
      maxY = Math.max(maxY, pos.y + tileHeight);
    }
  }

  const composites: sharp.OverlayOptions[] = [];
  for (let row = 0; row < grid.length; row++) {
    for (let col = 0; col < (grid[row]?.length ?? 0); col++) {
      const tile = grid[row][col];
      if (!tile) continue;
      const pos = positions[row][col];
      composites.push({ input: tile.buffer, left: Math.round(pos.x), top: Math.round(pos.y) });
    }
  }

  return sharp({
    create: {
      width: Math.ceil(maxX),
      height: Math.ceil(maxY),
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    },
  })
    .composite(composites)
    .png()
    .toBuffer();
}

export async function stitchAlignedTiles(
  grid: (Tile | null)[][],
  tileWidth: number,
  tileHeight: number,
  opts: AlignOptions = {}
): Promise<{ buffer: Buffer; alignment: GridAlignment }> {
  const alignment = await computeAlignedPositions(grid, tileWidth, tileHeight, opts);
  const buffer = await stitchAlignedGrid(grid, alignment.positions, tileWidth, tileHeight);
  return { buffer, alignment };
}
