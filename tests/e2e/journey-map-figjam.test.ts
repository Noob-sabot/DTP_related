import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { mkdirSync, rmSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { loadFigJamConfig } from "../../scripts/lib/figjam-config.js";
import { capturePageGrid, defaultPagePlan, openFigJamBoard } from "../../scripts/lib/figjam-map-capture.js";

const runE2e = process.env.FIGJAM_E2E === "1";
const __dirname = dirname(fileURLToPath(import.meta.url));
const TMP = join(__dirname, ".tmp-e2e");

describe("FigJam journey map e2e", { skip: !runE2e }, () => {
  it("opens board and captures one page after manual positioning", async () => {
    const config = loadFigJamConfig();
    const browser = await chromium.launch({ headless: false });
    const page = await browser.newPage({ viewport: config.viewport });
    try {
      await openFigJamBoard(page, config.boardUrl);
      const pagesDir = join(TMP, "manual-page");
      mkdirSync(pagesDir, { recursive: true });
      const plan = defaultPagePlan(config.viewport.width, config.viewport.height, config.tileOverlapPx);
      const captured = await capturePageGrid(
        page,
        pagesDir,
        { ...plan, pages: [plan.pages[0]] },
        config.tileOverlapPx
      );
      assert.equal(captured.length, 1);
      assert.ok(captured[0].path.endsWith("page-r0-c0.png"));
    } finally {
      await browser.close();
      rmSync(TMP, { recursive: true, force: true });
    }
  });
});
