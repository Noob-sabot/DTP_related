import { chromium } from "@playwright/test";
import type { Page, CDPSession } from "@playwright/test";
import { FIGMA_AUTH_STATE_PATH } from "./figjam-config.js";

const FIGMA_ORIGIN = "https://www.figma.com";

export async function launchFigmaBrowser(headed: boolean, authStatePath?: string) {
  // Figma blocks headless/datacenter browsers via CloudFront; headed mode is required in CI/cloud.
  const useHeaded = headed || Boolean(process.env.CI || process.env.CURSOR_AGENT);
  const browser = await chromium.launch({
    headless: !useHeaded,
    args: ["--disable-blink-features=AutomationControlled"],
  });
  const context = await browser.newContext({
    ...(authStatePath ? { storageState: authStatePath } : {}),
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    viewport: { width: 1920, height: 1080 },
    locale: "en-AU",
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });
  const page = await context.newPage();
  return { browser, context, page };
}

export async function openBoard(page: Page, boardUrl: string, nodeId?: string): Promise<void> {
  let url = boardUrl;
  if (nodeId) {
    const u = new URL(boardUrl);
    u.searchParams.set("node-id", nodeId.replace(":", "-"));
    url = u.toString();
  }
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.waitForTimeout(5000);
  await assertBoardAccessible(page);
  await dismissFigmaDialogs(page);
  await waitForCanvas(page);

  if (nodeId) {
    await focusCanvas(page);
    await page.waitForTimeout(500);
    await zoomToSelection(page);
    await page.waitForTimeout(1500);
  }
}

async function assertBoardAccessible(page: Page): Promise<void> {
  const title = await page.title();
  const body = await page.locator("body").innerText().catch(() => "");
  if (title.includes("ERROR") || body.includes("Request blocked") || body.includes("403 ERROR")) {
    throw new Error(
      "Figma blocked this browser (CloudFront 403). Run capture locally on your machine:\n" +
        "  npm run capture:journey-map -- --name \"Metro & town bus\" --headed"
    );
  }
}

export async function dismissFigmaDialogs(page: Page): Promise<void> {
  await page.evaluate(() => {
    for (const el of document.querySelectorAll("[class*='banner'], [class*='toast']")) {
      (el as HTMLElement).style.display = "none";
    }
  }).catch(() => {});

  for (const label of [
    "Allow all cookies",
    "Reject all",
    "Accept all",
    "Close",
    "Got it",
    "OK",
    "Dismiss",
    "Not now",
    "Skip",
    "Continue",
    "View only",
    "Open in browser",
  ]) {
    const btn = page.getByRole("button", { name: label });
    if (await btn.first().isVisible({ timeout: 800 }).catch(() => false)) {
      await btn.first().click().catch(() => {});
      await page.waitForTimeout(300);
    }
  }

  await page
    .evaluate(() => {
      for (const el of document.querySelectorAll(
        "[class*='cookie'], [class*='Cookie'], [class*='signup'], [class*='banner'], [class*='toast'], [class*='help_widget']"
      )) {
        (el as HTMLElement).style.display = "none";
      }
    })
    .catch(() => {});
}

async function waitForCanvas(page: Page): Promise<void> {
  const selectors = [
    "canvas",
    '[class*="viewport"]',
    '[data-testid="multiplayer-toolbar"]',
  ];
  for (const sel of selectors) {
    if (await page.locator(sel).first().isVisible({ timeout: 15_000 }).catch(() => false)) {
      return;
    }
  }
  console.warn("Canvas not detected by known selectors; continuing anyway.");
}

export async function ensureLoggedIn(page: Page): Promise<boolean> {
  const url = page.url();
  if (url.includes("/login") || url.includes("/start_google_sso")) {
    return false;
  }
  return true;
}

export async function findAndSelectMap(page: Page, mapName: string): Promise<void> {
  const searchTerms = [
    mapName,
    mapName.toUpperCase(),
    mapName.replace(/\s*&\s*/gi, " & ").toUpperCase(),
  ];

  await page.keyboard.press(process.platform === "darwin" ? "Meta+f" : "Control+f");
  await page.waitForTimeout(600);
  const searchInput = page
    .locator('input[placeholder*="Search" i], input[type="search"], input[aria-label*="find" i]')
    .first();
  if (await searchInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    await searchInput.fill(searchTerms[searchTerms.length - 1]);
    await page.waitForTimeout(800);
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press("Enter");
      await page.waitForTimeout(1200);
    }
  }
  await page.keyboard.press("Escape");
  await focusCanvas(page);
  await zoomToSelection(page);
  await page.waitForTimeout(1000);

  const mod = process.platform === "darwin" ? "Meta" : "Control";
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press(`${mod}+Equal`);
    await page.waitForTimeout(200);
  }
  await page.waitForTimeout(800);
}

async function focusCanvas(page: Page): Promise<void> {
  const canvas = page.locator("canvas").first();
  const box = await canvas.boundingBox();
  if (box) {
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(300);
  }
}

export async function zoomToSelection(page: Page): Promise<void> {
  await page.keyboard.press("Shift+1");
  await page.waitForTimeout(1200);
}

export async function setZoomPercent(page: Page, zoom: number): Promise<void> {
  await page.keyboard.press(process.platform === "darwin" ? "Meta+0" : "Control+0");
  await page.waitForTimeout(400);

  const mod = process.platform === "darwin" ? "Meta" : "Control";
  const steps = Math.round((zoom - 100) / 10);
  const key = steps >= 0 ? `${mod}+Equal` : `${mod}+Minus`;
  for (let i = 0; i < Math.abs(steps); i++) {
    await page.keyboard.press(key);
    await page.waitForTimeout(80);
  }
  await page.waitForTimeout(600);
}

export interface CaptureRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export async function getCanvasRegion(page: Page): Promise<CaptureRegion> {
  const canvas = page.locator("canvas").first();
  const box = await canvas.boundingBox();
  if (!box) {
    throw new Error("Could not find FigJam canvas element.");
  }
  return {
    x: Math.round(box.x),
    y: Math.round(box.y),
    width: Math.round(box.width),
    height: Math.round(box.height),
  };
}

export interface TileCaptureOptions {
  region: CaptureRegion;
  deviceScaleFactor: number;
  tileOverlapPx: number;
  panSettleMs: number;
  cols: number;
  rows: number;
}

export interface CapturedTileGrid {
  tiles: Buffer[][];
  tileWidth: number;
  tileHeight: number;
}

export async function setupHighDpiCapture(
  page: Page,
  deviceScaleFactor: number,
  viewport: { width: number; height: number }
): Promise<CDPSession> {
  await page.setViewportSize(viewport);
  const client = await page.context().newCDPSession(page);
  await client.send("Emulation.setDeviceMetricsOverride", {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor,
    mobile: false,
  });
  return client;
}

export async function captureViewportPng(page: Page, client: CDPSession, region: CaptureRegion): Promise<Buffer> {
  const result = await client.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: true,
    clip: {
      x: region.x,
      y: region.y,
      width: region.width,
      height: region.height,
      scale: 1,
    },
  });
  return Buffer.from(result.data, "base64");
}

export async function panCanvas(
  page: Page,
  region: CaptureRegion,
  dx: number,
  dy: number
): Promise<void> {
  const cx = region.x + region.width / 2;
  const cy = region.y + region.height / 2;

  await page.keyboard.press("h");
  await page.waitForTimeout(100);
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx - dx, cy - dy, { steps: 24 });
  await page.mouse.up();
  await page.keyboard.press("v");
  await page.waitForTimeout(100);
}

export function computeTileGrid(
  selectionCssWidth: number,
  selectionCssHeight: number,
  viewportWidth: number,
  viewportHeight: number,
  overlapPx: number
): { cols: number; rows: number } {
  const stepX = viewportWidth - overlapPx;
  const stepY = viewportHeight - overlapPx;
  const cols = Math.max(1, Math.ceil((selectionCssWidth - overlapPx) / stepX));
  const rows = Math.max(1, Math.ceil((selectionCssHeight - overlapPx) / stepY));
  return { cols, rows };
}

/**
 * Estimate selection size in CSS pixels from zoom level after zoom-to-fit.
 * FigJam doesn't expose bounds easily; we use heuristics or user-provided overrides.
 */
export function estimateSelectionSize(
  viewportWidth: number,
  viewportHeight: number,
  zoomPercent: number,
  override?: { width: number; height: number }
): { width: number; height: number } {
  if (override) return override;

  const scale = zoomPercent / 100;
  return {
    width: Math.round(viewportWidth * 1.8 * scale),
    height: Math.round(viewportHeight * 1.4 * scale),
  };
}

export async function captureTileGrid(
  page: Page,
  client: CDPSession,
  options: TileCaptureOptions
): Promise<CapturedTileGrid> {
  const { region, tileOverlapPx, panSettleMs, cols, rows } = options;
  const stepX = region.width - tileOverlapPx;
  const stepY = region.height - tileOverlapPx;

  const tiles: Buffer[][] = [];

  for (let row = 0; row < rows; row++) {
    const rowTiles: Buffer[] = [];
    for (let col = 0; col < cols; col++) {
      if (row > 0 || col > 0) {
        const panX = col > 0 ? stepX : 0;
        const panY = row > 0 && col === 0 ? stepY : 0;
        if (panX || panY) {
          await panCanvas(page, region, panX, panY);
          await page.waitForTimeout(panSettleMs);
        }
      }
      const buf = await captureViewportPng(page, client, region);
      rowTiles.push(buf);
      console.log(`  Captured tile [${row + 1}/${rows}, ${col + 1}/${cols}]`);
    }
    tiles.push(rowTiles);
  }

  return { tiles, tileWidth: region.width, tileHeight: region.height };
}

export async function captureSingleFrame(
  page: Page,
  client: CDPSession,
  region: CaptureRegion
): Promise<Buffer> {
  return captureViewportPng(page, client, region);
}

export { FIGMA_AUTH_STATE_PATH, FIGMA_ORIGIN };
