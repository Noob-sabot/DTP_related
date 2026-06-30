import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import sharp from "sharp";
import {
  normalizeMapSearchTerm,
  resolveMapSearchTerm,
  buildPageCapturePlan,
  mapMatchesSearchTerm,
  mapSearchQueries,
  isWrongMapHit,
  buildMapNavigationPlan,
  MAP_NAV_PHASES,
} from "../scripts/lib/journey-map-pipeline.js";
import { OcrQueue } from "../scripts/lib/ocr-queue.js";
import { stitchPagesToPdf } from "../scripts/lib/journey-map-pdf.js";
import {
  buildMapExports,
  writeValidationSample,
  type CapturedPage,
  type PageOcrResult,
} from "../scripts/lib/journey-map-export.js";
import { loadFigJamConfig } from "../scripts/lib/figjam-config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(__dirname, "fixtures/metro-town-bus-page0-validation.png");
const TMP = join(__dirname, ".tmp-journey-map");

before(() => mkdirSync(TMP, { recursive: true }));
after(() => rmSync(TMP, { recursive: true, force: true }));

describe("1 — find the right map", () => {
  it("normalises map names to FigJam search terms", () => {
    assert.equal(normalizeMapSearchTerm("Metro & town bus"), "METRO & TOWN BUS");
    assert.equal(normalizeMapSearchTerm("  metro tram  "), "METRO TRAM");
  });

  it("resolves pilot map from config when --name is omitted", () => {
    const config = loadFigJamConfig();
    const term = resolveMapSearchTerm(undefined, config);
    assert.equal(term, config.pilotSearchTerm ?? "METRO & TOWN BUS");
  });

  it("matches OCR text to the expected map", () => {
    assert.equal(mapMatchesSearchTerm("Metro & Town Bus Journey Stages", "METRO & TOWN BUS"), true);
    assert.equal(mapMatchesSearchTerm("V/LINE COACH timetable", "METRO & TOWN BUS"), false);
  });

  it("prefers specific search queries to avoid METRO TRAM collisions", () => {
    assert.deepEqual(mapSearchQueries("METRO & TOWN BUS"), ["& TOWN BUS", "TOWN BUS", "METRO & TOWN BUS"]);
  });

  it("rejects wrong-map OCR hits while searching", () => {
    assert.equal(isWrongMapHit("METRO & TOWN BUS", "METRO TRAM Journey Stages"), true);
    assert.equal(isWrongMapHit("METRO & TOWN BUS", "Metro & Town Bus Journey Steps"), false);
    assert.equal(isWrongMapHit("METRO & TOWN BUS", ""), false);
  });

  it("navigation plan zooms out before searching and zooming in", () => {
    const plan = buildMapNavigationPlan("METRO & TOWN BUS");
    assert.deepEqual(plan.phases, MAP_NAV_PHASES);
    assert.equal(plan.phases[0], "overview");
    assert.equal(plan.phases[1], "search");
    assert.ok(plan.overviewZoomOutSteps > 0);
    assert.ok(plan.readableZoomInSteps > 0);
  });
});

describe("2 — zoom to top-left of the map", () => {
  it("starts page grid at top-left with zero pan on first page", () => {
    const plan = buildPageCapturePlan({
      cols: 4,
      rows: 3,
      viewportWidth: 1920,
      viewportHeight: 1080,
      overlapPx: 120,
    });
    assert.equal(plan.pages[0].row, 0);
    assert.equal(plan.pages[0].col, 0);
    assert.equal(plan.pages[0].panDeltaX, 0);
    assert.equal(plan.pages[0].panDeltaY, 0);
    assert.equal(plan.stepX, 1920 - 120);
    assert.equal(plan.stepY, 1080 - 120);
  });

  it("pans right across columns then down for next row", () => {
    const plan = buildPageCapturePlan({
      cols: 3,
      rows: 2,
      viewportWidth: 1000,
      viewportHeight: 800,
      overlapPx: 100,
    });
    assert.deepEqual(
      plan.pages.map((p) => [p.row, p.col, p.panDeltaX, p.panDeltaY]),
      [
        [0, 0, 0, 0],
        [0, 1, 900, 0],
        [0, 2, 900, 0],
        [1, 0, 0, 700],
        [1, 1, 900, 0],
        [1, 2, 900, 0],
      ]
    );
  });
});

describe("3 — screenshot a page, OCR it, move to next page", () => {
  it("OCRs a page image and returns cells with text", async () => {
    const queue = new OcrQueue(1);
    await queue.start();
    const result = await queue.recognizePage(FIXTURE, { row: 0, col: 0, offsetX: 0, offsetY: 0 });
    await queue.stop();
    assert.ok(result.cells.length > 10, "expected readable text from validation fixture");
    const joined = result.cells.map((c) => c.text).join(" ").toLowerCase();
    assert.ok(joined.includes("journey stages"), joined.slice(0, 200));
    assert.ok(/how.*will.*get.*from.*a-b/i.test(joined));
  });

  it("queues OCR in background while capture continues", async () => {
    const queue = new OcrQueue(1);
    await queue.start();

    const page0 = queue.enqueue(FIXTURE, { row: 0, col: 0, offsetX: 0, offsetY: 0 });
    let page0Done = false;
    void page0.then(() => {
      page0Done = true;
    });

    // Simulate capturing next page while OCR runs
    const tiny = join(TMP, "page-1.png");
    await sharp({
      create: { width: 200, height: 100, channels: 3, background: { r: 255, g: 255, b: 255 } },
    })
      .png()
      .toFile(tiny);

    const page1Promise = queue.enqueue(tiny, { row: 0, col: 1, offsetX: 900, offsetY: 0 });
    const results = await queue.drain();
    await queue.stop();

    assert.equal(results.length, 2);
    assert.ok(page0Done, "first page OCR finished");
    assert.ok(results[0].cells.length > results[1].cells.length, "fixture has more text than blank page");
    assert.equal(results[1].position.col, 1);
    await page1Promise;
  });
});

describe("4 — stitch all pages into a PDF", () => {
  it("combines page PNGs into a multi-page PDF", async () => {
    const p0 = join(TMP, "pdf-p0.png");
    const p1 = join(TMP, "pdf-p1.png");
    await sharp({
      create: { width: 400, height: 300, channels: 3, background: { r: 200, g: 0, b: 0 } },
    })
      .png()
      .toFile(p0);
    await sharp({
      create: { width: 400, height: 300, channels: 3, background: { r: 0, g: 0, b: 200 } },
    })
      .png()
      .toFile(p1);

    const pdfPath = join(TMP, "stitched.pdf");
    await stitchPagesToPdf([p0, p1], pdfPath);
    assert.ok(existsSync(pdfPath));
    const buf = readFileSync(pdfPath);
    assert.ok(buf.slice(0, 5).toString() === "%PDF-", "output is a PDF file");
  });
});

describe("5 — make a TSV file", () => {
  it("builds journey-grid.tsv and cells-flat.tsv from OCR results", async () => {
    const queue = new OcrQueue(1);
    await queue.start();
    const ocr = await queue.recognizePage(FIXTURE, { row: 0, col: 0, offsetX: 0, offsetY: 0 });
    await queue.stop();

    const outDir = join(TMP, "tsv-out");
    const exports = buildMapExports([ocr], outDir, "metro-town-bus");
    assert.ok(existsSync(exports.gridPath));
    assert.ok(existsSync(exports.flatPath));
    const grid = readFileSync(exports.gridPath, "utf-8");
    assert.ok(grid.includes("Journey") || grid.includes("Stages"));
    const flat = readFileSync(exports.flatPath, "utf-8");
    assert.ok(flat.startsWith("x\ty\tconfidence\ttext"));
  });
});

describe("6 — early validation sample for user review", () => {
  it("writes first pages with screenshots and extracted text for review", async () => {
    const queue = new OcrQueue(1);
    await queue.start();
    const ocr = await queue.recognizePage(FIXTURE, { row: 0, col: 0, offsetX: 0, offsetY: 0 });
    await queue.stop();

    const pages: CapturedPage[] = [
      { row: 0, col: 0, path: FIXTURE },
      {
        row: 0,
        col: 1,
        path: FIXTURE,
      },
    ];
    const ocrResults: PageOcrResult[] = [ocr, { ...ocr, position: { row: 0, col: 1, offsetX: 900, offsetY: 0 } }];

    const validationDir = join(TMP, "validation");
    const report = writeValidationSample(pages, ocrResults, validationDir, 2);

    assert.ok(existsSync(join(validationDir, "page-r0-c0.png")));
    assert.ok(existsSync(join(validationDir, "page-r0-c0.txt")));
    assert.ok(existsSync(join(validationDir, "validation-report.json")));
    assert.equal(report.pages.length, 2);
    assert.ok(report.pages[0].phrasesMatched >= 5, "enough phrases matched for user sign-off");
    assert.ok(report.pages[0].previewText.length > 50);
  });
});
