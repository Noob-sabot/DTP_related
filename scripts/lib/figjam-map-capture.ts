import type { Page } from "@playwright/test";
import {
  DEFAULT_PAGE_COLS,
  DEFAULT_PAGE_ROWS,
  DEFAULT_ZOOM_STEPS,
  buildPageCapturePlan,
  type PageCapturePlan,
} from "./journey-map-pipeline.js";
import {
  dismissFigmaDialogs,
  getCanvasRegion,
  panCanvas,
} from "./figjam-capture.js";

export { DEFAULT_PAGE_COLS, DEFAULT_PAGE_ROWS, DEFAULT_ZOOM_STEPS, buildPageCapturePlan };

export async function openFigJamBoard(page: Page, boardUrl: string): Promise<void> {
  await page.goto(boardUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(3000);
  await dismissFigmaDialogs(page);
}

/** Search FigJam for the map and zoom to a readable top-left starting view. */
export async function findMapAndZoomTopLeft(
  page: Page,
  searchTerm: string,
  zoomSteps = DEFAULT_ZOOM_STEPS
): Promise<void> {
  await page.keyboard.press("Meta+f");
  await page.waitForTimeout(400);
  const input = page.locator('input[placeholder*="Search" i], input[type="search"]').first();
  if (await input.isVisible({ timeout: 2000 }).catch(() => false)) {
    await input.fill(searchTerm);
    await page.waitForTimeout(600);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(1500);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(1000);
  }
  await page.keyboard.press("Escape");

  const canvas = page.locator("canvas").first();
  const box = await canvas.boundingBox();
  if (box) {
    // Click top-left quadrant so zoom centres on map origin, not board centre.
    await page.mouse.click(box.x + box.width * 0.25, box.y + box.height * 0.25);
    await page.waitForTimeout(300);
  }

  await page.keyboard.press("Shift+2");
  await page.waitForTimeout(800);

  for (let i = 0; i < zoomSteps; i++) {
    await page.keyboard.press("Meta+Equal");
    await page.waitForTimeout(200);
  }
  await page.waitForTimeout(1000);
}

export interface CapturedPageFile {
  row: number;
  col: number;
  path: string;
  offsetX: number;
  offsetY: number;
}

export async function capturePageGrid(
  page: Page,
  pagesDir: string,
  plan: PageCapturePlan,
  overlapPx: number
): Promise<CapturedPageFile[]> {
  const { join } = await import("path");
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
