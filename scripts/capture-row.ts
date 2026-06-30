import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import { loadFigJamConfig, resolveOutputDir } from "./lib/figjam-config.js";
import { getCanvasRegion, panCanvas } from "./lib/figjam-capture.js";
import { openFigJamBoard } from "./lib/figjam-map-capture.js";
import { waitForGo } from "./lib/wait-for-go.js";
import { detectRowEnd, MAX_ROW_TILES, findTranslateOffset } from "./lib/capture-row.js";
import { writeStitchRow } from "./lib/stitch-row.js";

function parseArgs(argv: string[]) {
  let panX: number | undefined;
  let maxTiles = MAX_ROW_TILES;
  let outName = "auto-row";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--pan-x") panX = Number(argv[++i]);
    else if (argv[i] === "--max") maxTiles = Number(argv[++i]);
    else if (argv[i] === "--out") outName = argv[++i];
  }
  return { panX, maxTiles, outName };
}

async function screenshotCanvas(page: import("@playwright/test").Page, path: string): Promise<void> {
  await page.locator("canvas").first().screenshot({ path });
  console.log(`  Saved ${path}`);
}

async function main() {
  const config = loadFigJamConfig();
  const { panX, maxTiles, outName } = parseArgs(process.argv.slice(2));
  const outDir = join(resolveOutputDir(config), outName);
  const tilesDir = join(outDir, "tiles");
  mkdirSync(tilesDir, { recursive: true });

  let stepX = panX ?? config.viewport.width - config.tileOverlapPx;
  const tilePaths: string[] = [];
  const endChecks: unknown[] = [];

  console.log("Automated row capture");
  console.log(`  stepX=${stepX}px  maxTiles=${maxTiles}  out=${outDir}`);

  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage({ viewport: config.viewport });

  try {
    await openFigJamBoard(page, config.boardUrl);

    console.log("\n── Position the LEFT edge of the map, then type go ──");
    await waitForGo({
      prompt:
        "Zoom to your preferred level. Pan so the LEFT side of the map is visible.\n" +
        "Type go in this terminal — capture will pan right automatically until the end.",
    });

    const region = await getCanvasRegion(page);

    for (let i = 0; i < maxTiles; i++) {
      if (i > 0) {
        await panCanvas(page, region, stepX, 0);
        await page.waitForTimeout(config.panSettleMs ?? 400);
      }

      const path = join(tilesDir, `tile-${String(tilePaths.length).padStart(2, "0")}.png`);
      await screenshotCanvas(page, path);

      if (tilePaths.length > 0) {
        const check = await detectRowEnd(tilePaths[tilePaths.length - 1], path, stepX);
        endChecks.push({ tile: tilePaths.length, ...check });
        console.log(
          `  end check: ${check.reason} (overlap=${check.overlapScore.toFixed(3)}, sim=${check.similarity.toFixed(3)})`
        );
        if (check.stop) {
          unlinkSync(path);
          console.log(`  Stopping at ${tilePaths.length} tiles — ${check.reason}`);
          break;
        }
      }

      tilePaths.push(path);

      if (tilePaths.length === 2) {
        const rel = await findTranslateOffset(tilePaths[0], tilePaths[1], stepX);
        if (rel.score > 0.5) {
          stepX = rel.pan;
          console.log(`  Calibrated stepX=${stepX}px from first pair (score ${rel.score.toFixed(3)})`);
        }
      }

      if (tilePaths.length >= maxTiles) {
        console.log(`  Stopping at cap of ${maxTiles} tiles`);
        break;
      }
    }
  } finally {
    await browser.close();
  }

  const metaPath = join(outDir, "capture.json");
  writeFileSync(
    metaPath,
    JSON.stringify(
      {
        stepX,
        tileCount: tilePaths.length,
        tiles: tilePaths.map((p) => p.split("/").pop()),
        endChecks,
        hitCap: tilePaths.length >= maxTiles,
      },
      null,
      2
    )
  );

  console.log(`\n── Stitching ${tilePaths.length} tiles ──`);
  const stitchedPath = join(outDir, "stitched-row.png");
  const result = await writeStitchRow(tilePaths, stitchedPath, stepX);

  console.log(`\nDone:\n  ${stitchedPath} (${result.width}×${result.height}px)`);
  console.log(`  Tiles: ${tilesDir}/`);
  console.log(`  Meta:  ${metaPath}`);
  if (tilePaths.length >= maxTiles) {
    console.log(`  Note: hit ${maxTiles}-tile cap — end detection may need tuning.`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
