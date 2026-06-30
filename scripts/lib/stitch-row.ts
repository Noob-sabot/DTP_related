import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";
import sharp from "sharp";
import { findTranslateOffset } from "./capture-row.js";

export interface TilePlacement {
  path: string;
  pan: number;
  dy: number;
  score: number;
}

export interface StitchRowResult {
  buffer: Buffer;
  width: number;
  height: number;
  placements: TilePlacement[];
}

/** Stitch a horizontal row using translate offsets between consecutive tiles. */
export async function stitchRowTiles(
  tilePaths: string[],
  expectedStep?: number
): Promise<StitchRowResult> {
  if (tilePaths.length === 0) throw new Error("No tiles to stitch");
  if (tilePaths.length === 1) {
    const buf = readFileSync(tilePaths[0]);
    const meta = await sharp(buf).metadata();
    return {
      buffer: buf,
      width: meta.width ?? 1920,
      height: meta.height ?? 1080,
      placements: [{ path: tilePaths[0], pan: 0, dy: 0, score: 1 }],
    };
  }

  const meta0 = await sharp(readFileSync(tilePaths[0])).metadata();
  const tileWidth = meta0.width ?? 1920;
  const tileHeight = meta0.height ?? 1080;
  const step = expectedStep ?? Math.round(tileWidth * 0.68);

  const placements: TilePlacement[] = [{ path: tilePaths[0], pan: 0, dy: 0, score: 1 }];
  let absPan = 0;
  let absDy = 0;

  for (let i = 1; i < tilePaths.length; i++) {
    const rel = await findTranslateOffset(tilePaths[i - 1], tilePaths[i], step);
    absPan += rel.pan;
    absDy += rel.dy;
    placements.push({ path: tilePaths[i], pan: absPan, dy: absDy, score: rel.score });
    console.log(
      `  tile ${i}: +pan ${rel.pan}px +dy ${rel.dy}px (score ${rel.score.toFixed(3)}) → abs pan ${absPan} dy ${absDy}`
    );
  }

  let minX = 0;
  let minY = 0;
  let maxX = tileWidth;
  let maxY = tileHeight;
  for (const p of placements) {
    minX = Math.min(minX, p.pan);
    minY = Math.min(minY, p.dy);
    maxX = Math.max(maxX, p.pan + tileWidth);
    maxY = Math.max(maxY, p.dy + tileHeight);
  }
  const outW = maxX - minX;
  const outH = maxY - minY;

  const layers = placements.map((p) => ({
    input: readFileSync(p.path),
    left: p.pan - minX,
    top: p.dy - minY,
  }));

  const buffer = await sharp({
    create: {
      width: outW,
      height: outH,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    },
  })
    .composite(layers)
    .png()
    .toBuffer();

  return { buffer, width: outW, height: outH, placements };
}

export async function writeStitchRow(
  tilePaths: string[],
  outPath: string,
  expectedStep?: number
): Promise<StitchRowResult> {
  const result = await stitchRowTiles(tilePaths, expectedStep);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, result.buffer);
  return result;
}
