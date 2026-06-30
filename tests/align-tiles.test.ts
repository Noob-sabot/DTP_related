import { describe, it } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import {
  findHorizontalOverlap,
  findVerticalOverlap,
  stitchAlignedTiles,
} from "../scripts/lib/align-tiles.js";
import type { Tile } from "../scripts/lib/stitch-tiles.js";

async function tileWithMarker(
  width: number,
  height: number,
  bg: { r: number; g: number; b: number },
  marker?: { x: number; y: number; w: number; h: number; color: { r: number; g: number; b: number } }
): Promise<Buffer> {
  let img = sharp({
    create: { width, height, channels: 3, background: bg },
  });
  if (marker) {
    const patch = await sharp({
      create: {
        width: marker.w,
        height: marker.h,
        channels: 3,
        background: marker.color,
      },
    })
      .png()
      .toBuffer();
    img = img.composite([{ input: patch, left: marker.x, top: marker.y }]);
  }
  return img.png().toBuffer();
}

describe("align-tiles", () => {
  it("finds horizontal overlap between two tiles with a shared edge pattern", async () => {
    const w = 400;
    const h = 200;
    const overlap = 120;
    const shared = { r: 40, g: 120, b: 200 };

    const left = await tileWithMarker(w, h, { r: 200, g: 200, b: 200 }, { x: w - overlap, y: 50, w: overlap, h: 80, color: shared });
    const right = await tileWithMarker(w, h, { r: 180, g: 180, b: 180 }, { x: 0, y: 50, w: overlap, h: 80, color: shared });

    const result = await findHorizontalOverlap(left, right, w, h, { minOverlap: 80, minVariance: 50 });
    assert.ok(Math.abs(result.overlap - overlap) <= 8, `expected ~${overlap}, got ${result.overlap}`);
  });

  it("finds vertical overlap between two stacked tiles", async () => {
    const w = 300;
    const h = 250;
    const overlap = 90;
    const shared = { r: 90, g: 30, b: 30 };

    const top = await tileWithMarker(w, h, { r: 220, g: 220, b: 220 }, { x: 40, y: h - overlap, w: 200, h: overlap, color: shared });
    const bottom = await tileWithMarker(w, h, { r: 210, g: 210, b: 210 }, { x: 40, y: 0, w: 200, h: overlap, color: shared });

    const result = await findVerticalOverlap(top, bottom, w, h, { minOverlap: 60, minVariance: 50 });
    assert.ok(Math.abs(result.overlap - overlap) <= 4, `expected ~${overlap}, got ${result.overlap}`);
  });

  it("stitches a 2×1 row without gaps", async () => {
    const w = 300;
    const h = 150;
    const overlap = 80;
    const shared = { r: 50, g: 50, b: 50 };

    const left = await tileWithMarker(w, h, { r: 240, g: 240, b: 240 }, { x: w - overlap, y: 30, w: overlap, h: 60, color: shared });
    const right = await tileWithMarker(w, h, { r: 230, g: 230, b: 230 }, { x: 0, y: 30, w: overlap, h: 60, color: shared });

    const grid: Tile[][] = [
      [
        { buffer: left, row: 0, col: 0 },
        { buffer: right, row: 0, col: 1 },
      ],
    ];

    const { buffer } = await stitchAlignedTiles(grid, w, h, { minOverlap: 60, minVariance: 50 });
    const meta = await sharp(buffer).metadata();
    assert.equal(meta.width, w + w - overlap);
  });
});
