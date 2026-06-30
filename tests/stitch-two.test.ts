import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import sharp from "sharp";
import { writeStitchTwo } from "../scripts/lib/stitch-two.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TMP = join(__dirname, ".tmp-stitch-two");

describe("stitchTwoImages", () => {
  it("stitches two existing metro-town-bus pages quickly", async () => {
    const pages = join(__dirname, "../exports/dtp-accessibility-journey-maps/metro-town-bus/pages");
    const left = join(pages, "page-r0-c0.png");
    const right = join(pages, "page-r0-c1.png");
    const out = join(TMP, "stitched-two.png");
    mkdirSync(TMP, { recursive: true });

    const start = Date.now();
    const result = await writeStitchTwo(left, right, out, { force: true });
    const elapsed = Date.now() - start;

    assert.ok(elapsed < 60_000, `took ${elapsed}ms`);
    assert.ok(result.overlap > 150);
    assert.ok(result.width < 1920 * 2);
    const meta = await sharp(out).metadata();
    assert.ok((meta.width ?? 0) > 2000);

    rmSync(TMP, { recursive: true, force: true });
  });
});
