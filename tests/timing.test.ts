import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  TimingSession,
  formatMs,
  startTimingSession,
  finishTiming,
  timed,
} from "../scripts/lib/timing.js";

describe("timing", () => {
  it("formats milliseconds", () => {
    assert.equal(formatMs(42), "42ms");
    assert.equal(formatMs(1500), "1.50s");
  });

  it("aggregates by label", async () => {
    const s = new TimingSession();
    await s.timed("a", async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
    await s.timed("a", async () => {});
    await s.timed("b", async () => {});
    const { byLabel } = s.report();
    const a = byLabel.find((r) => r.label === "a");
    assert.equal(a?.count, 2);
    assert.ok(a!.totalMs >= 4);
  });

  it("session helpers write report", async () => {
    startTimingSession();
    await timed("test.op", async () => 1);
    const report = finishTiming();
    assert.equal(report?.byLabel[0]?.label, "test.op");
  });
});
