import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { loadFigJamConfig, resolveOutputDir } from "./lib/figjam-config.js";
import { getCanvasRegion, panCanvas } from "./lib/figjam-capture.js";
import { openFigJamBoard } from "./lib/figjam-map-capture.js";
import { waitForGo } from "./lib/wait-for-go.js";
import { guessAlignment, writeAlignPreview } from "./lib/stitch-two.js";

const OUT_DIR = join(resolveOutputDir(loadFigJamConfig()), "stitch-pilot");

function parseCaptureArgs(argv: string[]) {
  let auto = false;
  let panX: number | undefined;
  let panY = 0;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--auto") auto = true;
    else if (argv[i] === "--pan-x") panX = Number(argv[++i]);
    else if (argv[i] === "--pan-y") panY = Number(argv[++i]);
  }
  return { auto, panX, panY };
}

async function screenshotCanvas(page: import("@playwright/test").Page, path: string): Promise<void> {
  await page.locator("canvas").first().screenshot({ path });
  console.log(`  Saved ${path}`);
}

async function main() {
  const config = loadFigJamConfig();
  const { auto, panX, panY } = parseCaptureArgs(process.argv.slice(2));
  mkdirSync(OUT_DIR, { recursive: true });

  const leftPath = join(OUT_DIR, "left.png");
  const rightPath = join(OUT_DIR, "right.png");
  const previewPath = join(OUT_DIR, "align-preview.png");
  const metaPath = join(OUT_DIR, "capture.json");

  const stepX = panX ?? config.viewport.width - config.tileOverlapPx;

  console.log("Two-screenshot stitch pilot");
  if (auto) {
    console.log(`  Programmatic pan: ${stepX}px horizontal, ${panY}px vertical`);
  } else {
    console.log("  Manual pan between shots (recommended until alignment is tuned)");
  }

  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage({ viewport: config.viewport });

  try {
    await openFigJamBoard(page, config.boardUrl);

    if (auto) {
      console.log("\n── Position map at the LEFT edge, then type go ──");
      await waitForGo({
        prompt:
          "Zoom to your preferred level. Pan so the LEFT side of the map is visible.\n" +
          "Type go in this terminal when ready.",
      });
      await screenshotCanvas(page, leftPath);

      const region = await getCanvasRegion(page);
      await panCanvas(page, region, stepX, panY);
      await page.waitForTimeout(config.panSettleMs ?? 500);
      await screenshotCanvas(page, rightPath);
    } else {
      console.log("\n── Step 1: position the LEFT edge of the map ──");
      await waitForGo({
        prompt:
          "Zoom to your preferred level. Pan so the LEFT side of the map is visible.\n" +
          "Type go in this terminal when ready.",
      });
      await screenshotCanvas(page, leftPath);

      console.log("\n── Step 2: pan RIGHT (keep overlap visible) ──");
      await waitForGo({
        prompt:
          "Pan RIGHT. Keep overlapping rows visible between shots.\n" +
          "Type go in this terminal when ready.",
      });
      await screenshotCanvas(page, rightPath);
    }
  } finally {
    await browser.close();
  }

  writeFileSync(
    metaPath,
    JSON.stringify({ mode: auto ? "auto" : "manual", stepX, stepY: panY }, null, 2)
  );

  console.log("\n── Alignment preview (not auto-stitching) ──");
  const guess = await guessAlignment(leftPath, rightPath);
  await writeAlignPreview(leftPath, rightPath, previewPath, {
    pan: guess.pan,
    dy: guess.dy,
    alpha: 0.45,
  });

  console.log(`\nCaptures saved:\n  ${leftPath}\n  ${rightPath}`);
  console.log(`\nOpen ${previewPath}`);
  console.log("  The right shot is semi-transparent over the left — tune until rows line up.");
  console.log(`  Auto guess: pan=${guess.pan}px  dy=${guess.dy}px  (confident=${guess.confident})`);
  console.log(`  ${guess.note}`);
  console.log(
    "\nAlign in browser:\n" +
      `  npm run stitch:align -- ${leftPath} ${rightPath}\n` +
      "  (drag right image, Try snap / Undo snap, then Save stitched PNG)\n" +
      "Or CLI tune:\n" +
      `  npm run stitch:preview -- ${leftPath} ${rightPath} --pan ${guess.pan} --dy ${guess.dy}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
