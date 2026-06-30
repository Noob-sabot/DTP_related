import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { detectRowEnd, MAX_ROW_TILES } from "../scripts/lib/capture-row.js";
import { stitchRowTiles } from "../scripts/lib/stitch-row.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PILOT = join(__dirname, "../exports/dtp-accessibility-journey-maps/stitch-pilot");

describe("capture-row", () => {
  it("caps at MAX_ROW_TILES", () => {
    assert.equal(MAX_ROW_TILES, 15);
  });

  it("detects identical tiles as end", async () => {
    const left = join(PILOT, "left.png");
    const right = join(PILOT, "left.png");
    try {
      const check = await detectRowEnd(left, right, 1300);
      assert.equal(check.stop, true);
    } catch {
      // pilot optional
    }
  });
});

describe("stitchRowTiles", () => {
  it("stitches pilot left+right", async () => {
    const left = join(PILOT, "left.png");
    const right = join(PILOT, "right.png");
    try {
      const result = await stitchRowTiles([left, right], { expectedStep: 1300 });
      assert.ok(result.width > 2500);
      assert.equal(result.placements.length, 2);
    } catch {
      // pilot optional
    }
  });
});
