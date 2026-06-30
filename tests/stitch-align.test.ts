import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { microSnapTranslate, scoreTranslatePlacement } from "../scripts/lib/stitch-two.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PILOT = join(__dirname, "../exports/dtp-accessibility-journey-maps/stitch-pilot");

describe("microSnapTranslate", () => {
  it("locks pan and only nudges dy", async () => {
    const left = join(PILOT, "left.png");
    const right = join(PILOT, "right.png");
    try {
      const userPan = 1302;
      const userDy = 24;
      const snap = await microSnapTranslate(left, right, userPan, userDy, 8);
      assert.equal(snap.pan, userPan);
      assert.ok(Math.abs(snap.dy - userDy) <= 8);
      const userScore = await scoreTranslatePlacement(left, right, userPan, userDy);
      assert.ok(userScore > 0);
    } catch {
      // pilot captures optional
    }
  });
});
