import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import sharp from "sharp";
import { writeAlignPreview } from "../scripts/lib/stitch-two.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TMP = join(__dirname, ".tmp-stitch-preview");
const PILOT = join(__dirname, "../exports/dtp-accessibility-journey-maps/stitch-pilot");

describe("alignPreview", () => {
  it("writes a semi-transparent overlay for manual tuning", async () => {
    const left = join(PILOT, "left.png");
    const right = join(PILOT, "right.png");
    const out = join(TMP, "align-preview.png");
    mkdirSync(TMP, { recursive: true });

    const result = await writeAlignPreview(left, right, out, { pan: 710, dy: 6, alpha: 0.45 });
    assert.ok(result.width > 2000);
    const meta = await sharp(out).metadata();
    assert.equal(meta.channels, 4);

    rmSync(TMP, { recursive: true, force: true });
  });
});
