import { mkdirSync, writeFileSync, unlinkSync, rmSync, readdirSync } from "fs";
import { join } from "path";
import type { CDPSession } from "@playwright/test";
import {
  loadFigJamConfig,
  resolveOutputDir,
  getFigmaAuthState,
} from "./lib/figjam-config.js";
import {
  findAndSelectMap,
  getCanvasRegion,
  launchFigmaBrowser,
  panCanvas,
  dismissFigmaDialogs,
  setupHighDpiCapture,
  captureViewportPng,
  type CaptureRegion,
} from "./lib/figjam-capture.js";
import { resolveMapSearchTerm } from "./lib/journey-map-pipeline.js";
import { waitForGo } from "./lib/wait-for-go.js";
import {
  detectRowEnd,
  MAX_ROW_TILES,
  findTranslateOffset,
} from "./lib/capture-row.js";
import { writeStitchRow } from "./lib/stitch-row.js";
import { startTimingSession, timed, finishTiming } from "./lib/timing.js";

function parseArgs(argv: string[]) {
  let panX: number | undefined;
  let maxTiles = MAX_ROW_TILES;
  let outName = "auto-row";
  let findMap = false;
  let mapName: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--pan-x") panX = Number(argv[++i]);
    else if (argv[i] === "--max") maxTiles = Number(argv[++i]);
    else if (argv[i] === "--out") outName = argv[++i];
    else if (argv[i] === "--find-map") findMap = true;
    else if (argv[i] === "--map" || argv[i] === "--name") {
      mapName = argv[++i];
      findMap = true;
    }
  }
  return { panX, maxTiles, outName, findMap, mapName };
}

async function main() {
  const config = loadFigJamConfig();
  const { panX, maxTiles, outName, findMap, mapName } = parseArgs(process.argv.slice(2));
  const outDir = join(resolveOutputDir(config), outName);
  const tilesDir = join(outDir, "tiles");
  mkdirSync(tilesDir, { recursive: true });

  startTimingSession();

  const dsf = config.deviceScaleFactor ?? 2;
  let stepXCss =
    panX ?? config.defaultStepPanPx ?? config.viewport.width - config.tileOverlapPx;
  const tilePaths: string[] = [];
  const endChecks: unknown[] = [];
  const searchTerm = findMap ? resolveMapSearchTerm(mapName, config) : undefined;
  let alignPanPx: number | undefined;
  let alignDy = 0;

  console.log("Automated row capture");
  console.log(`  stepX=${stepXCss}px CSS  dsf=${dsf}  maxTiles=${maxTiles}  out=${outDir}`);
  if (searchTerm) console.log(`  find-map=${searchTerm} (you still set zoom/position before go)`);

  const { browser, page } = await timed("capture.browser.launch", () =>
    launchFigmaBrowser(true, getFigmaAuthState())
  );
  let client: CDPSession | undefined;
  let region: CaptureRegion | undefined;

  const screenshotCanvas = async (path: string, tileIndex: number) => {
    if (!client || !region) throw new Error("Capture not initialized");
    await timed(
      "capture.screenshot",
      async () => {
        const buf = await captureViewportPng(page, client!, region!);
        writeFileSync(path, buf);
        const meta = await import("sharp").then((s) => s.default(buf).metadata());
        console.log(`  Saved ${path} (${meta.width}×${meta.height})`);
      },
      { tile: tileIndex }
    );
  };

  try {
    await timed("capture.browser.openBoard", async () => {
      await page.goto(config.boardUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await page.waitForTimeout(3000);
      await dismissFigmaDialogs(page);
    });

    if (searchTerm) {
      console.log(`\n── Jumping to map: ${searchTerm} (rough) ──`);
      await timed("capture.findMap", () => findAndSelectMap(page, searchTerm));
      console.log("  Adjust zoom and pan to the LEFT edge before typing go.");
    }

    console.log("\n── Set your start position, then type go ──");
    await timed("capture.waitForGo", () =>
      waitForGo({
        prompt:
          "In the browser: set zoom and pan so the LEFT edge of the map row is visible.\n" +
          "Type go in this terminal when ready — capture will pan right automatically until the end.",
      })
    );

    await timed("capture.prepareTilesDir", async () => {
      rmSync(tilesDir, { recursive: true, force: true });
      mkdirSync(tilesDir, { recursive: true });
      const stale = readdirSync(outDir).filter((f) => f.startsWith("tile-") && f.endsWith(".png"));
      for (const f of stale) unlinkSync(join(outDir, f));
    });

    await timed("capture.setupHiDpi", async () => {
      client = await setupHighDpiCapture(page, dsf, config.viewport);
      region = await getCanvasRegion(page);
    });

    for (let i = 0; i < maxTiles; i++) {
      if (i > 0) {
        await timed(
          "capture.pan",
          async () => {
            await panCanvas(page, region!, stepXCss, 0);
            await page.waitForTimeout(config.panSettleMs ?? 400);
          },
          { tile: i }
        );
      }

      const path = join(tilesDir, `tile-${String(tilePaths.length).padStart(2, "0")}.png`);
      await screenshotCanvas(path, tilePaths.length);

      const panDevice = alignPanPx ?? Math.round(stepXCss * dsf);

      if (tilePaths.length > 0) {
        const check = await timed(
          "capture.detectRowEnd",
          () => detectRowEnd(tilePaths[tilePaths.length - 1], path, panDevice, alignDy),
          { tile: tilePaths.length }
        );
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

      if (tilePaths.length === 2 && alignPanPx == null) {
        const rel = await timed("capture.calibrateAlignment", () =>
          findTranslateOffset(tilePaths[0], tilePaths[1], Math.round(stepXCss * dsf))
        );
        if (rel.score > 0.5) {
          alignPanPx = rel.pan;
          alignDy = rel.dy;
          stepXCss = Math.round(rel.pan / dsf);
          console.log(
            `  Calibrated: ${stepXCss}px CSS / ${alignPanPx}px device, dy=${alignDy} (score ${rel.score.toFixed(3)})`
          );
        }
      }

      if (tilePaths.length >= maxTiles) {
        console.log(`  Stopping at cap of ${maxTiles} tiles`);
        break;
      }
    }
  } finally {
    await timed("capture.browser.close", () => browser.close());
  }

  const panDevice = alignPanPx ?? Math.round(stepXCss * dsf);
  const metaPath = join(outDir, "capture.json");
  await timed("capture.writeMeta", async () => {
    writeFileSync(
      metaPath,
      JSON.stringify(
        {
          stepXCss,
          stepXPx: panDevice,
          stepDy: alignDy,
          deviceScaleFactor: dsf,
          tileCount: tilePaths.length,
          tiles: tilePaths.map((p) => p.split("/").pop()),
          endChecks,
          hitCap: tilePaths.length >= maxTiles,
          map: searchTerm,
        },
        null,
        2
      )
    );
  });

  console.log(`\n── Stitching ${tilePaths.length} tiles ──`);
  const stitchedPath = join(outDir, "stitched-row.png");
  const result = await writeStitchRow(tilePaths, stitchedPath, {
    fixedPan: panDevice,
    fixedDy: alignDy,
    expectedStep: panDevice,
    cropChrome: false,
  });

  console.log(`\nDone:\n  ${stitchedPath} (${result.width}×${result.height}px)`);
  if (result.crop) {
    console.log(`  Crop: top=${result.crop.top}px bottom=${result.crop.bottom}px`);
  }
  console.log(`  Tiles: ${tilesDir}/`);
  console.log(`  Meta:  ${metaPath}`);

  finishTiming(join(outDir, "timing.json"), "capture-row");

  if (tilePaths.length >= maxTiles) {
    console.log(`  Note: hit ${maxTiles}-tile cap — end detection may need tuning.`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
