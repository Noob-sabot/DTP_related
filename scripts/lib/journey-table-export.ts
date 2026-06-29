import type { TextCell } from "./figma-api.js";

export interface GridOptions {
  rowTolerance?: number;
  minColumnGap?: number;
}

/**
 * Cluster text cells by Y position into rows, then sort each row by X into columns.
 */
export function cellsToGrid(cells: TextCell[], options: GridOptions = {}): string[][] {
  if (cells.length === 0) return [];

  const heights = cells.map((c) => c.y).sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let i = 1; i < heights.length; i++) gaps.push(heights[i] - heights[i - 1]);
  gaps.sort((a, b) => a - b);
  const medianGap = gaps[Math.floor(gaps.length / 2)] ?? 80;
  const rowTolerance = options.rowTolerance ?? Math.max(40, medianGap * 0.45);

  const sorted = [...cells].sort((a, b) => a.cy - b.cy || a.cx - b.cx);
  const rowGroups: TextCell[][] = [];

  for (const cell of sorted) {
    const lastRow = rowGroups[rowGroups.length - 1];
    if (!lastRow) {
      rowGroups.push([cell]);
      continue;
    }
    const rowY = lastRow.reduce((s, c) => s + c.cy, 0) / lastRow.length;
    if (Math.abs(cell.cy - rowY) <= rowTolerance) {
      lastRow.push(cell);
    } else {
      rowGroups.push([cell]);
    }
  }

  for (const row of rowGroups) {
    row.sort((a, b) => a.cx - b.cx);
  }

  const maxCols = Math.max(...rowGroups.map((r) => r.length));
  return rowGroups.map((row) => {
    const texts = row.map((c) => c.text);
    while (texts.length < maxCols) texts.push("");
    return texts;
  });
}

export function gridToTsv(grid: string[][]): string {
  return grid.map((row) => row.map(escapeTsvField).join("\t")).join("\n");
}

export function gridToCsv(grid: string[][]): string {
  return grid.map((row) => row.map(escapeCsvField).join(",")).join("\n");
}

function escapeTsvField(value: string): string {
  return value.replace(/\t/g, " ").replace(/\r?\n/g, " ");
}

function escapeCsvField(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function cellsToFlatTable(cells: TextCell[]): string[][] {
  const grid = cellsToGrid(cells);
  return [["Row", "Col", "Text"], ...grid.flatMap((row, ri) =>
    row.map((text, ci) => [String(ri + 1), String(ci + 1), text]).filter((r) => r[2])
  )];
}
