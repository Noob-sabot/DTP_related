import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import sharp from "sharp";
import { stitchAlignedTiles } from "./align-tiles.js";
import { stitchTiles, type Tile } from "./stitch-tiles.js";

const PAGE_NAME = /^page-r(\d+)-c(\d+)\.png$/i;

export interface PageFile {
  row: number;
  col: number;
  path: string;
}

export interface StitchPagesOptions {
  overlapPx: number;
  deviceScaleFactor?: number;
  /** Use pixel matching instead of fixed overlap (default true). */
  align?: boolean;
}

export function discoverPageFiles(pagesDir: string): PageFile[] {
  return readdirSync(pagesDir)
    .map((name) => {
      const m = name.match(PAGE_NAME);
      if (!m) return null;
      return { row: Number(m[1]), col: Number(m[2]), path: join(pagesDir, name) };
    })
    .filter((p): p is PageFile => p !== null)
    .sort((a, b) => a.row - b.row || a.col - b.col);
}

export function pagesToGrid(pages: PageFile[]): { rows: number; cols: number; grid: (Tile | null)[][] } {
  if (pages.length === 0) throw new Error("No page-r*-c*.png files found");

  const maxRow = Math.max(...pages.map((p) => p.row));
  const maxCol = Math.max(...pages.map((p) => p.col));
  const rows = maxRow + 1;
  const cols = maxCol + 1;

  const grid: (Tile | null)[][] = Array.from({ length: rows }, () => Array(cols).fill(null));

  for (const page of pages) {
    grid[page.row][page.col] = {
      buffer: readFileSync(page.path),
      row: page.row,
      col: page.col,
    };
  }

  return { rows, cols, grid };
}

export async function stitchPageFiles(
  pagesDir: string,
  options: StitchPagesOptions
): Promise<{
  buffer: Buffer;
  rows: number;
  cols: number;
  width: number;
  height: number;
  alignment?: Awaited<ReturnType<typeof stitchAlignedTiles>>["alignment"];
}> {
  const pages = discoverPageFiles(pagesDir);
  const { rows, cols, grid } = pagesToGrid(pages);

  const first = await sharp(pages[0].path).metadata();
  const tileWidth = first.width ?? 1920;
  const tileHeight = first.height ?? 1080;

  const useAlign = options.align !== false;

  if (useAlign) {
    const { buffer, alignment } = await stitchAlignedTiles(grid, tileWidth, tileHeight);
    const meta = await sharp(buffer).metadata();
    return {
      buffer,
      rows,
      cols,
      width: meta.width ?? 0,
      height: meta.height ?? 0,
      alignment,
    };
  }

  const buffer = await stitchTiles(grid as Tile[][], tileWidth, tileHeight, {
    overlapPx: options.overlapPx,
    deviceScaleFactor: options.deviceScaleFactor ?? 1,
  });

  const meta = await sharp(buffer).metadata();
  return {
    buffer,
    rows,
    cols,
    width: meta.width ?? 0,
    height: meta.height ?? 0,
  };
}

export async function writeStitchedPages(
  pagesDir: string,
  outPath: string,
  options: StitchPagesOptions
): Promise<{
  outPath: string;
  rows: number;
  cols: number;
  width: number;
  height: number;
  alignment?: Awaited<ReturnType<typeof stitchAlignedTiles>>["alignment"];
}> {
  const result = await stitchPageFiles(pagesDir, options);
  mkdirSync(join(outPath, ".."), { recursive: true });
  writeFileSync(outPath, result.buffer);
  return {
    outPath,
    rows: result.rows,
    cols: result.cols,
    width: result.width,
    height: result.height,
    alignment: result.alignment,
  };
}
