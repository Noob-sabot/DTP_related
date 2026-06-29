import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { cellsToGrid } from "../scripts/lib/journey-table-export.js";
import type { TextCell } from "../scripts/lib/figma-api.js";

function cell(text: string, cx: number, cy: number): TextCell {
  return { text, x: cx, y: cy, cx, cy, nodeType: "TEXT", nodeName: "" };
}

describe("cellsToGrid", () => {
  it("clusters cells into rows and columns by position", () => {
    const cells = [
      cell("Stage A", 100, 50),
      cell("Stage B", 300, 50),
      cell("Pain 1", 100, 200),
      cell("Pain 2", 300, 200),
    ];
    const grid = cellsToGrid(cells, { rowTolerance: 60 });
    assert.equal(grid.length, 2);
    assert.equal(grid[0][0], "Stage A");
    assert.equal(grid[0][1], "Stage B");
    assert.equal(grid[1][0], "Pain 1");
    assert.equal(grid[1][1], "Pain 2");
  });
});
