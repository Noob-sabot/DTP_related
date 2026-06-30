import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";
import sharp from "sharp";
import { findTranslateOffset } from "./capture-row.js";
import { cropMapChrome, detectMapChromeCrop, detectMapChromeCropMerged, type MapChromeCrop } from "./crop-map-chrome.js";
import { timed } from "./timing.js";

export interface TilePlacement {
  path: string;
  pan: number;
  dy: number;
  score: number;
}

export interface StitchRowOptions {
  expectedStep?: number;
  fixedPan?: number;
  fixedDy?: number;
  cropChrome?: boolean;
}

export interface StitchRowResult {
  buffer: Buffer;
  width: number;
  height: number;
  placements: TilePlacement[];
  crop?: MapChromeCrop;
}

/** Stitch a horizontal row using translate offsets between consecutive tiles. */
export async function stitchRowTiles(
  tilePaths: string[],
  options: StitchRowOptions = {}
): Promise<StitchRowResult> {
  return timed("stitch.rowTiles", async () => {
    if (tilePaths.length === 0) throw new Error("No tiles to stitch");
    if (tilePaths.length === 1) {
      const buf = readFileSync(tilePaths[0]);
      let crop: MapChromeCrop | undefined;
      let out = buf;
      if (options.cropChrome !== false) {
        crop = await detectMapChromeCrop(buf);
        out = await cropMapChrome(buf, crop);
      }
      const meta = await sharp(out).metadata();
      return {
        buffer: out,
        width: meta.width ?? 1920,
        height: meta.height ?? 1080,
        placements: [{ path: tilePaths[0], pan: 0, dy: 0, score: 1 }],
        crop,
      };
    }

    const meta0 = await sharp(readFileSync(tilePaths[0])).metadata();
    const tileWidth = meta0.width ?? 1920;
    const tileHeight = meta0.height ?? 1080;
    const step = options.expectedStep ?? Math.round(tileWidth * 0.68);

    const placements: TilePlacement[] = [{ path: tilePaths[0], pan: 0, dy: 0, score: 1 }];
    let absPan = 0;
    let absDy = 0;

    if (options.fixedPan != null) {
      const pan = options.fixedPan;
      const dy = options.fixedDy ?? 0;
      await timed("stitch.placement.fixed", async () => {
        for (let i = 1; i < tilePaths.length; i++) {
          absPan += pan;
          absDy += dy;
          placements.push({ path: tilePaths[i], pan: absPan, dy: absDy, score: 1 });
        }
      });
      console.log(`  fixed alignment: +pan ${pan}px +dy ${dy}px per tile`);
    } else {
      await timed("stitch.placement.search", async () => {
        for (let i = 1; i < tilePaths.length; i++) {
          const rel = await findTranslateOffset(tilePaths[i - 1], tilePaths[i], step);
          absPan += rel.pan;
          absDy += rel.dy;
          placements.push({ path: tilePaths[i], pan: absPan, dy: absDy, score: rel.score });
          console.log(
            `  tile ${i}: +pan ${rel.pan}px +dy ${rel.dy}px (score ${rel.score.toFixed(3)}) → abs pan ${absPan} dy ${absDy}`
          );
        }
      });
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

    const layers = await timed("stitch.loadLayers", async () =>
      placements.map((p) => ({
        input: readFileSync(p.path),
        left: p.pan - minX,
        top: p.dy - minY,
      }))
    );

    let buffer = await timed("stitch.composite", async () =>
      sharp({
        create: {
          width: outW,
          height: outH,
          channels: 4,
          background: { r: 255, g: 255, b: 255, alpha: 1 },
        },
      })
        .composite(layers)
        .png()
        .toBuffer()
    );

    let crop: MapChromeCrop | undefined;
    if (options.cropChrome !== false) {
      crop = await detectMapChromeCropMerged(buffer);
      buffer = await timed("stitch.crop.apply", async () =>
        sharp(buffer)
          .extract({ left: 0, top: crop!.top, width: crop!.width, height: crop!.height })
          .png()
          .toBuffer()
      );
      console.log(`  cropped chrome: top=${crop.top}px bottom=${crop.bottom}px → ${crop.width}×${crop.height}`);
    }

    return {
      buffer,
      width: crop?.width ?? outW,
      height: crop?.height ?? outH,
      placements,
      crop,
    };
  }, { tiles: tilePaths.length });
}

export async function writeStitchRow(
  tilePaths: string[],
  outPath: string,
  options: StitchRowOptions | number = {}
): Promise<StitchRowResult> {
  return timed("stitch.writeRow", async () => {
    const opts: StitchRowOptions =
      typeof options === "number" ? { expectedStep: options } : options;
    const result = await stitchRowTiles(tilePaths, opts);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, result.buffer);
    return result;
  }, { tiles: tilePaths.length });
}
