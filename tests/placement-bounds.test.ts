import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { placementBounds } from "../scripts/lib/stitch-two.js";

describe("placementBounds", () => {
  it("crops to union of two offset tiles", () => {
    const b = placementBounds(1920, 1080, 1303, 24);
    assert.equal(b.width, 1303 + 1920);
    assert.equal(b.height, 1080 + 24);
    assert.ok(b.leftX === 0 && Number(b.leftY) === 0);
    assert.equal(b.rightX, 1303);
    assert.equal(b.rightY, 24);
  });

  it("handles negative offsets", () => {
    const b = placementBounds(1920, 1080, -100, -50);
    assert.equal(b.leftX, 100);
    assert.equal(b.leftY, 50);
    assert.equal(b.rightX, 0);
    assert.equal(b.rightY, 0);
  });
});
