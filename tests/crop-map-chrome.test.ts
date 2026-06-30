import { describe, it } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import {
  bottomCropFromTop,
  detectMapChromeCrop,
  cropMapChrome,
} from "../scripts/lib/crop-map-chrome.js";

describe("crop-map-chrome", () => {
  it("bottom crop is top × 1.2", () => {
    assert.equal(bottomCropFromTop(100), 120);
    assert.equal(bottomCropFromTop(50), 60);
  });

  it("detects black header below light toolbar", async () => {
    const w = 400;
    const h = 300;
    const raw = Buffer.alloc(w * h);
    for (let y = 0; y < h; y++) {
      const v = y < 80 ? 245 : y < 100 ? 20 : 200;
      for (let x = 0; x < w; x++) raw[y * w + x] = v;
    }
    const png = await sharp(raw, { raw: { width: w, height: h, channels: 1 } }).png().toBuffer();
    const crop = await detectMapChromeCrop(png, { blackThreshold: 80, minDarkRows: 2 });
    assert.ok(crop.top >= 75 && crop.top <= 105);
    assert.equal(crop.bottom, bottomCropFromTop(crop.top));
    assert.equal(crop.height, h - crop.top - crop.bottom);
  });

  it("crops image to content band", async () => {
    const w = 200;
    const h = 100;
    const raw = Buffer.alloc(w * h);
    for (let y = 0; y < h; y++) {
      const v = y < 20 ? 250 : 30;
      for (let x = 0; x < w; x++) raw[y * w + x] = v;
    }
    const png = await sharp(raw, { raw: { width: w, height: h, channels: 1 } }).png().toBuffer();
    const crop = await detectMapChromeCrop(png);
    const out = await cropMapChrome(png, crop);
    const meta = await sharp(out).metadata();
    assert.equal(meta.height, crop.height);
  });
});
