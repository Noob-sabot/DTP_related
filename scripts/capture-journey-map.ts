import { chromium } from "@playwright/test";
import { mkdirSync } from "fs";
import { join } from "path";
import { loadFigJamConfig, resolveOutputDir, slugify } from "./lib/figjam-config.js";

const MAPS = [
  "METRO TRAM",
  "METRO & TOWN BUS",
  "V/LINE TRAIN",
  "V/LINE COACH",
  "CPV (Taxi & Uber)",
  "REGIONAL BUS",
  "REGIONAL TRAIN",
  "TRAM",
  "INTERSTATE COACH",
  "INTERSTATE TRAIN",
  "FLEX RIDE",
  "ON DEMAND",
];

function parseArgs(argv: string[]) {
  return {
    name: argv.find((a, i) => argv[i - 1] === "--name"),
    all: argv.includes("--all"),
    list: argv.includes("--list"),
  };
}

async function dismissBanners(page: import("@playwright/test").Page): Promise<void> {
  for (const label of ["Close", "Got it", "OK", "Continue", "Dismiss"]) {
    const btn = page.getByRole("button", { name: label });
    if (await btn.first().isVisible({ timeout: 500 }).catch(() => false)) {
      await btn.first().click().catch(() => {});
    }
  }
}

async function searchMap(page: import("@playwright/test").Page, term: string): Promise<void> {
  await page.keyboard.press("Meta+f");
  await page.waitForTimeout(400);
  const input = page.locator('input[placeholder*="Search" i], input[type="search"]').first();
  if (await input.isVisible({ timeout: 2000 }).catch(() => false)) {
    await input.fill(term);
    await page.waitForTimeout(600);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(1200);
  }
  await page.keyboard.press("Escape");
  await page.keyboard.press("Shift+1");
  await page.waitForTimeout(1500);
}

async function screenshotCanvas(page: import("@playwright/test").Page, outputPath: string): Promise<void> {
  const canvas = page.locator("canvas").first();
  await canvas.waitFor({ state: "visible", timeout: 30_000 });
  await canvas.screenshot({ path: outputPath });
}

async function captureOne(
  page: import("@playwright/test").Page,
  boardUrl: string,
  searchTerm: string,
  outputPath: string
): Promise<void> {
  await page.goto(boardUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(3000);
  await dismissBanners(page);
  await searchMap(page, searchTerm);
  await screenshotCanvas(page, outputPath);
}

async function main() {
  const config = loadFigJamConfig();
  const args = parseArgs(process.argv.slice(2));
  const outputDir = resolveOutputDir(config);
  mkdirSync(outputDir, { recursive: true });

  if (args.list) {
    console.log(MAPS.map((m) => `  - ${m}`).join("\n"));
    return;
  }

  const terms = args.all ? MAPS : [config.pilotSearchTerm ?? args.name ?? config.pilotMapName.toUpperCase()];

  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });

  try {
    for (const term of terms) {
      const fileName = `${slugify(term)}.png`;
      const outputPath = join(outputDir, fileName);
      console.log(`Screenshot: ${term} → ${outputPath}`);
      await captureOne(page, config.boardUrl, term, outputPath);
    }
    console.log(`\nDone. ${terms.length} screenshot(s) in ${outputDir}`);
  } finally {
    await browser.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
