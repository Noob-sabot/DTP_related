import type { Page } from "@playwright/test";
import { join } from "path";
import {
  DEFAULT_PAGE_COLS,
  DEFAULT_PAGE_ROWS,
  buildPageCapturePlan,
  type PageCapturePlan,
} from "./journey-map-pipeline.js";
import { dismissFigmaDialogs, getCanvasRegion, panCanvas } from "./figjam-capture.js";

export { DEFAULT_PAGE_COLS, DEFAULT_PAGE_ROWS, buildPageCapturePlan };

export async function openFigJamBoard(page: Page, boardUrl: string): Promise<void> {
  await page.goto(boardUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(3000);
  await dismissFigmaDialogs(page);
}

export interface CapturedPageFile {
  row: number;
  col: number;
  path: string;
  offsetX: number;
  offsetY: number;
}

/** Screenshot the canvas, pan right across columns, then down rows. Assumes view is already positioned at top-left. */
export async function capturePageGrid(
  page: Page,
  pagesDir: string,
  plan: PageCapturePlan,
  _overlapPx: number
): Promise<CapturedPageFile[]> {
  const region = await getCanvasRegion(page);
  const captured: CapturedPageFile[] = [];

  for (const entry of plan.pages) {
    if (entry.panDeltaX || entry.panDeltaY) {
      await panCanvas(page, region, entry.panDeltaX, entry.panDeltaY);
      await page.waitForTimeout(500);
    }

    const path = join(pagesDir, `page-r${entry.row}-c${entry.col}.png`);
    await page.locator("canvas").first().screenshot({ path });
    captured.push({
      row: entry.row,
      col: entry.col,
      path,
      offsetX: entry.col * plan.stepX,
      offsetY: entry.row * plan.stepY,
    });
    console.log(`  Page [${entry.row + 1}/${plan.rows}, ${entry.col + 1}/${plan.cols}]`);
  }

  return captured;
}

export function defaultPagePlan(viewportWidth: number, viewportHeight: number, overlapPx: number): PageCapturePlan {
  return buildPageCapturePlan({
    cols: DEFAULT_PAGE_COLS,
    rows: DEFAULT_PAGE_ROWS,
    viewportWidth,
    viewportHeight,
    overlapPx,
  });
}
