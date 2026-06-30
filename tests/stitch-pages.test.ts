import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import sharp from "sharp";
import { discoverPageFiles, stitchPageFiles } from "../scripts/lib/stitch-pages.js";

async function tileWithMarker(
  width: number,
  height: number,
  bg: { r: number; g: number; b: number },
  marker?: { x: number; y: number; w: number; h: number; color: { r: number; g: number; b: number } }
): Promise<Buffer> {
  let img = sharp({ create: { width, height, channels: 3, background: bg } });
  if (marker) {
    const patch = await sharp({
      create: { width: marker.w, height: marker.h, channels: 3, background: marker.color },
    })
      .png()
      .toBuffer();
    img = img.composite([{ input: patch, left: marker.x, top: marker.y }]);
  }
  return img.png().toBuffer();
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PAGES = join(__dirname, "../exports/dtp-accessibility-journey-maps/metro-town-bus/pages");
const TMP = join(__dirname, ".tmp-stitch");

describe("stitchPageFiles", () => {
  it("discovers page-r*-c*.png files in row-major order", () => {
    const pages = discoverPageFiles(FIXTURE_PAGES);
    assert.equal(pages.length, 12);
    assert.equal(pages[0].row, 0);
    assert.equal(pages[0].col, 0);
    assert.equal(pages[11].row, 2);
    assert.equal(pages[11].col, 3);
  });

  it("stitches captured pages into one image (pixel-aligned)", async () => {
    mkdirSync(TMP, { recursive: true });
    const result = await stitchPageFiles(FIXTURE_PAGES, { overlapPx: 100, deviceScaleFactor: 1, align: true });
    assert.ok(result.buffer.length > 100_000);
    assert.equal(result.rows, 3);
    assert.equal(result.cols, 4);
    assert.ok(result.alignment);
    assert.ok(result.alignment.horizontalOverlaps[0][1] > 150);
    assert.ok(result.width! < 7000, `aligned width ${result.width} should be tighter than naive stitch`);
    rmSync(TMP, { recursive: true, force: true });
  });

  it("stitches a synthetic 2×1 row", async () => {
    mkdirSync(TMP, { recursive: true });
    const dir = join(TMP, "pages");
    mkdirSync(dir);

    const overlap = 80;
    const shared = { r: 50, g: 50, b: 50 };
    const w = 200;
    const h = 100;

    const left = await tileWithMarker(w, h, { r: 240, g: 240, b: 240 }, { x: w - overlap, y: 20, w: overlap, h: 40, color: shared });
    const right = await tileWithMarker(w, h, { r: 230, g: 230, b: 230 }, { x: 0, y: 20, w: overlap, h: 40, color: shared });

    await sharp(left).toFile(join(dir, "page-r0-c0.png"));
    await sharp(right).toFile(join(dir, "page-r0-c1.png"));

    const result = await stitchPageFiles(dir, { overlapPx: 20, deviceScaleFactor: 1, align: true });
    assert.equal(result.cols, 2);
    assert.equal(result.width, w + w - overlap);

    rmSync(TMP, { recursive: true, force: true });
  });
});
