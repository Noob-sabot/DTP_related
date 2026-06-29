import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { mkdirSync, rmSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { loadFigJamConfig } from "../../scripts/lib/figjam-config.js";
import { resolveMapSearchTerm, mapMatchesSearchTerm } from "../../scripts/lib/journey-map-pipeline.js";
import {
  capturePageGrid,
  defaultPagePlan,
  findMapAndZoomTopLeft,
  openFigJamBoard,
} from "../../scripts/lib/figjam-map-capture.js";
import { ocrImage } from "../../scripts/lib/ocr-tiles.js";

const runE2e = process.env.FIGJAM_E2E === "1";
const __dirname = dirname(fileURLToPath(import.meta.url));
const TMP = join(__dirname, ".tmp-e2e");

describe("FigJam journey map e2e", { skip: !runE2e }, () => {
  it("finds the pilot map on the board", async () => {
    const config = loadFigJamConfig();
    const searchTerm = resolveMapSearchTerm(undefined, config);
    const browser = await chromium.launch({ headless: false });
    const page = await browser.newPage({ viewport: config.viewport });
    try {
      await openFigJamBoard(page, config.boardUrl);
      await findMapAndZoomTopLeft(page, searchTerm, 4);
      const pagesDir = join(TMP, "find-map");
      mkdirSync(pagesDir, { recursive: true });
      const plan = defaultPagePlan(config.viewport.width, config.viewport.height, config.tileOverlapPx);
      const captured = await capturePageGrid(page, pagesDir, { ...plan, pages: [plan.pages[0]] }, config.tileOverlapPx);
      const cells = await ocrImage(captured[0].path);
      const text = cells.map((c) => c.text).join(" ");
      assert.ok(mapMatchesSearchTerm(text, searchTerm) || text.toLowerCase().includes("journey"), text.slice(0, 200));
    } finally {
      await browser.close();
      rmSync(TMP, { recursive: true, force: true });
    }
  });
});
