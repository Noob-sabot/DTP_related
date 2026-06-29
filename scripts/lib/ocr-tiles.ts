import { createWorker } from "tesseract.js";
import { readFileSync } from "fs";
import sharp from "sharp";

export interface OcrCell {
  text: string;
  x: number;
  y: number;
  cx: number;
  cy: number;
  confidence: number;
}

export interface TileMeta {
  col: number;
  row: number;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
  path: string;
}

/** Parse tesseract TSV (level 5 = word). Columns: level page block par line word left top width height conf text */
export function parseTsv(tsv: string, offsetX = 0, offsetY = 0, minConfidence = 40): OcrCell[] {
  const lines = tsv.trim().split("\n");
  const firstCols = lines[0]?.split("\t") ?? [];
  const hasHeader = firstCols[0] === "level";
  const start = hasHeader ? 1 : 0;

  const cells: OcrCell[] = [];
  const lineTexts = new Map<string, { texts: string[]; left: number; top: number; width: number; height: number; conf: number[] }>();

  for (let i = start; i < lines.length; i++) {
    const cols = lines[i].split("\t");
    if (cols.length < 12) continue;

    const level = Number(cols[0]);
    const left = Number(cols[6]) + offsetX;
    const top = Number(cols[7]) + offsetY;
    const width = Number(cols[8]);
    const height = Number(cols[9]);
    const conf = Number(cols[10]);
    const text = cols[11]?.trim();
    if (!text) continue;

    if (level === 5 && conf >= minConfidence) {
      cells.push({
        text,
        x: left,
        y: top,
        cx: left + width / 2,
        cy: top + height / 2,
        confidence: conf,
      });
    }

    if (level === 5 && conf >= 25) {
      const lineKey = cols.slice(0, 6).join("-");
      const entry = lineTexts.get(lineKey) ?? { texts: [], left, top, width: 0, height, conf: [] };
      entry.texts.push(text);
      entry.left = Math.min(entry.left, left);
      entry.top = Math.min(entry.top, top);
      entry.width = Math.max(entry.width, left + width - entry.left);
      entry.height = Math.max(entry.height, height);
      entry.conf.push(conf);
      lineTexts.set(lineKey, entry);
    }
  }

  for (const entry of lineTexts.values()) {
    const line = entry.texts.join(" ").trim();
    if (line.length < 8) continue;
    const avgConf = entry.conf.reduce((a, b) => a + b, 0) / entry.conf.length;
    if (avgConf < 35) continue;
    cells.push({
      text: line,
      x: entry.left,
      y: entry.top,
      cx: entry.left + entry.width / 2,
      cy: entry.top + entry.height / 2,
      confidence: avgConf,
    });
  }

  const seen = new Set<string>();
  return cells.filter((c) => {
    const key = `${Math.round(c.cy / 8)}:${c.text.slice(0, 50)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function preprocessForOcr(path: string, scale = 2): Promise<Buffer> {
  return sharp(path)
    .resize({ width: Math.round((await sharp(path).metadata()).width! * scale) })
    .normalize()
    .sharpen()
    .png()
    .toBuffer();
}

export async function ocrImage(path: string, offsetX = 0, offsetY = 0, scale = 2): Promise<OcrCell[]> {
  const worker = await createWorker("eng");
  try {
    const image = scale > 1 ? await preprocessForOcr(path, scale) : readFileSync(path);
    const { data } = await worker.recognize(image, {}, { tsv: true });
    const factor = scale > 1 ? scale : 1;
    return parseTsv(data.tsv ?? "", offsetX, offsetY).map((c) => ({
      ...c,
      x: c.x / factor,
      y: c.y / factor,
      cx: c.cx / factor,
      cy: c.cy / factor,
    }));
  } finally {
    await worker.terminate();
  }
}

export async function ocrAllTiles(tiles: TileMeta[]): Promise<OcrCell[]> {
  const worker = await createWorker("eng");
  const all: OcrCell[] = [];

  try {
    for (const tile of tiles) {
      console.log(`  OCR tile r${tile.row} c${tile.col}...`);
      const { data } = await worker.recognize(readFileSync(tile.path), {}, { tsv: true });
      all.push(...parseTsv(data.tsv ?? "", tile.offsetX, tile.offsetY));
    }
  } finally {
    await worker.terminate();
  }

  const seen = new Set<string>();
  return all.filter((c) => {
    const key = `${Math.round(c.cx / 12)}:${Math.round(c.cy / 12)}:${c.text.slice(0, 24)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function ocrCellsToTextCells(cells: OcrCell[]) {
  return cells.map((c) => ({
    text: c.text,
    x: c.x,
    y: c.y,
    cx: c.cx,
    cy: c.cy,
    nodeType: "OCR",
    nodeName: "",
  }));
}
