import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { loadFigJamConfig, resolveOutputDir, slugify } from "./lib/figjam-config.js";
import { resolveMapSearchTerm } from "./lib/journey-map-pipeline.js";
import { capturePageGrid, defaultPagePlan, openFigJamBoard } from "./lib/figjam-map-capture.js";
import { waitForGo } from "./lib/wait-for-go.js";
import { OcrQueue } from "./lib/ocr-queue.js";
import { buildMapExports, writeValidationSample } from "./lib/journey-map-export.js";
import { stitchPagesToPdf } from "./lib/journey-map-pdf.js";

const TILE_OVERLAP = 120;
const VALIDATION_PAGES = 2;

function parseArgs(argv: string[]) {
  return {
    name: argv.find((a, i) => argv[i - 1] === "--name"),
    pagesOnly: argv.includes("--pages-only"),
    ocrOnly: argv.includes("--ocr-only"),
    auto: argv.includes("--auto"),
  };
}

async function main() {
  const config = loadFigJamConfig();
  const args = parseArgs(process.argv.slice(2));
  const searchTerm = resolveMapSearchTerm(args.name, config);
  const baseName = slugify(searchTerm);
  const outputRoot = resolveOutputDir(config);
  const mapDir = join(outputRoot, baseName);
  const pagesDir = join(mapDir, "pages");
  const validationDir = join(mapDir, "validation");
  mkdirSync(pagesDir, { recursive: true });

  let captured: Awaited<ReturnType<typeof capturePageGrid>> = [];

  if (!args.ocrOnly) {
    console.log(`Manual capture: ${searchTerm}`);
    const browser = await chromium.launch({ headless: false });
    const page = await browser.newPage({
      viewport: config.viewport ?? { width: 1920, height: 1080 },
    });

    try {
      await openFigJamBoard(page, config.boardUrl);

      if (!args.auto) {
        await waitForGo({
          prompt:
            "Position the map at the top-left corner.\n" +
            "Type go in this terminal when ready.",
        });
      }

      const plan = defaultPagePlan(
        config.viewport?.width ?? 1920,
        config.viewport?.height ?? 1080,
        config.tileOverlapPx ?? TILE_OVERLAP
      );

      console.log(`Capturing ${plan.pages.length} pages (pan right, then down)...`);
      captured = await capturePageGrid(page, pagesDir, plan, config.tileOverlapPx ?? TILE_OVERLAP);
      console.log(`  Saved ${captured.length} pages`);
    } finally {
      await browser.close();
    }
  } else {
    const plan = defaultPagePlan(
      config.viewport?.width ?? 1920,
      config.viewport?.height ?? 1080,
      config.tileOverlapPx ?? TILE_OVERLAP
    );
    for (const entry of plan.pages) {
      captured.push({
        row: entry.row,
        col: entry.col,
        path: join(pagesDir, `page-r${entry.row}-c${entry.col}.png`),
        offsetX: entry.col * plan.stepX,
        offsetY: entry.row * plan.stepY,
      });
    }
  }

  if (args.pagesOnly) {
    console.log("Pages only — skipping OCR.");
    return;
  }

  console.log("Running OCR (first page sync, rest in background)...");
  const queue = new OcrQueue(2);
  await queue.start();

  const ocrResults = [];
  for (let i = 0; i < captured.length; i++) {
    const p = captured[i];
    const pos = { row: p.row, col: p.col, offsetX: p.offsetX, offsetY: p.offsetY };
    if (i === 0) {
      const first = await queue.recognizePage(p.path, pos);
      ocrResults.push(first);
      console.log(`  Page r${p.row}c${p.col}: ${first.cells.length} cells (verified)`);
    } else {
      ocrResults.push(queue.enqueue(p.path, pos));
    }
  }

  const resolved = await Promise.all(ocrResults);
  await queue.stop();
  console.log(`  OCR complete: ${resolved.reduce((s, r) => s + r.cells.length, 0)} total cells`);

  buildMapExports(resolved, mapDir, baseName);
  await stitchPagesToPdf(
    captured.map((p) => p.path),
    join(mapDir, `${baseName}.pdf`)
  );

  const validation = writeValidationSample(
    captured.map((p) => ({ row: p.row, col: p.col, path: p.path })),
    resolved,
    validationDir,
    VALIDATION_PAGES
  );

  writeFileSync(
    join(mapDir, "capture-manifest.json"),
    JSON.stringify(
      {
        mapName: searchTerm,
        mode: args.auto ? "auto" : "manual",
        pageCount: captured.length,
        validationPages: validation.pages,
        pdf: `${baseName}.pdf`,
        extractedAt: new Date().toISOString(),
      },
      null,
      2
    )
  );

  console.log(
    `\nDone:\n  ${mapDir}/journey-grid.tsv\n  ${mapDir}/${baseName}.pdf\n  ${validationDir}/ (review first ${VALIDATION_PAGES} pages)`
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
