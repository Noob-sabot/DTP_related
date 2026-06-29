import { copyFileSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { cellsToGrid, gridToTsv } from "./journey-table-export.js";
import { ocrCellsToTextCells } from "./ocr-tiles.js";
import type { PageOcrResult } from "./ocr-queue.js";

export interface CapturedPage {
  row: number;
  col: number;
  path: string;
}

export interface ValidationPageReport {
  row: number;
  col: number;
  screenshot: string;
  textFile: string;
  cellCount: number;
  phrasesMatched: number;
  previewText: string;
}

export interface ValidationReport {
  pages: ValidationPageReport[];
  note: string;
  extractedAt: string;
}

const REVIEW_PHRASES = [
  "journey stages",
  "journey steps",
  "moments that matter",
  "thoughts",
  "decisions",
  "how",
  "will get",
  "a-b",
  "accessible",
  "public transport",
];

function countPhrases(text: string): number {
  const hay = text.toLowerCase();
  return REVIEW_PHRASES.filter((p) => hay.includes(p)).length;
}

export function buildMapExports(
  ocrResults: PageOcrResult[],
  outDir: string,
  baseName: string
): { gridPath: string; flatPath: string; manifestPath: string } {
  mkdirSync(outDir, { recursive: true });

  const allCells = ocrResults.flatMap((r) => r.cells);
  const grid = cellsToGrid(ocrCellsToTextCells(allCells));
  const gridPath = join(outDir, "journey-grid.tsv");
  const flatPath = join(outDir, "cells-flat.tsv");
  const manifestPath = join(outDir, "manifest.json");

  writeFileSync(gridPath, gridToTsv(grid));
  writeFileSync(
    flatPath,
    gridToTsv([
      ["x", "y", "confidence", "text"],
      ...allCells.map((c) => [
        String(Math.round(c.cx)),
        String(Math.round(c.cy)),
        String(Math.round(c.confidence)),
        c.text,
      ]),
    ])
  );
  writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        mapName: baseName,
        pageCount: ocrResults.length,
        ocrCellCount: allCells.length,
        gridRows: grid.length,
        gridCols: grid[0]?.length ?? 0,
        extractedAt: new Date().toISOString(),
      },
      null,
      2
    )
  );

  return { gridPath, flatPath, manifestPath };
}

export function writeValidationSample(
  pages: CapturedPage[],
  ocrResults: PageOcrResult[],
  outDir: string,
  maxPages = 2
): ValidationReport {
  mkdirSync(outDir, { recursive: true });

  const sample = pages.slice(0, maxPages);
  const reportPages: ValidationPageReport[] = [];

  for (let i = 0; i < sample.length; i++) {
    const page = sample[i];
    const ocr = ocrResults[i];
    const base = `page-r${page.row}-c${page.col}`;
    const screenshot = join(outDir, `${base}.png`);
    const textFile = join(outDir, `${base}.txt`);

    copyFileSync(page.path, screenshot);

    const lines = ocr?.cells.map((c) => c.text) ?? [];
    const previewText = lines.join("\n");
    writeFileSync(textFile, previewText);

    reportPages.push({
      row: page.row,
      col: page.col,
      screenshot: `${base}.png`,
      textFile: `${base}.txt`,
      cellCount: ocr?.cells.length ?? 0,
      phrasesMatched: countPhrases(previewText),
      previewText: previewText.slice(0, 500),
    });
  }

  const report: ValidationReport = {
    pages: reportPages,
    note: "Review these screenshots and extracted text before running the full capture.",
    extractedAt: new Date().toISOString(),
  };

  writeFileSync(join(outDir, "validation-report.json"), JSON.stringify(report, null, 2));
  return report;
}
