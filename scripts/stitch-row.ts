import { readdirSync, readFileSync, existsSync, writeFileSync } from "fs";
import { join } from "path";
import sharp from "sharp";
import { loadFigJamConfig, resolveOutputDir } from "./lib/figjam-config.js";
import { stitchRowTiles } from "./lib/stitch-row.js";
import { detectMapChromeCropMerged } from "./lib/crop-map-chrome.js";

function parseArgs(argv: string[]) {
  let outName = "auto-row";
  let maxTiles: number | undefined;
  let panPx: number | undefined;
  let dy = 0;
  let scale = 1;
  let hqName = "stitched-row-hq.png";
  let crop = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--out") outName = argv[++i];
    else if (argv[i] === "--max") maxTiles = Number(argv[++i]);
    else if (argv[i] === "--pan") panPx = Number(argv[++i]);
    else if (argv[i] === "--dy") dy = Number(argv[++i]);
    else if (argv[i] === "--scale") scale = Number(argv[++i]);
    else if (argv[i] === "--hq") hqName = argv[++i];
    else if (argv[i] === "--crop") crop = true;
  }
  return { outName, maxTiles, panPx, dy, scale, hqName, crop };
}

async function main() {
  const config = loadFigJamConfig();
  const { outName, maxTiles, panPx, dy, scale, hqName, crop } = parseArgs(process.argv.slice(2));
  const outDir = join(resolveOutputDir(config), outName);
  const tilesDir = join(outDir, "tiles");
  const metaPath = join(outDir, "capture.json");

  let tilePaths = readdirSync(tilesDir)
    .filter((f) => /^tile-\d+\.png$/.test(f))
    .sort()
    .map((f) => join(tilesDir, f));

  if (maxTiles != null) tilePaths = tilePaths.slice(0, maxTiles);

  if (tilePaths.length === 0) {
    console.error(`No tiles in ${tilesDir}`);
    process.exit(1);
  }

  let fixedPan = panPx;
  let fixedDy = dy;
  if (fixedPan == null && existsSync(metaPath)) {
    const meta = JSON.parse(readFileSync(metaPath, "utf-8")) as {
      stepXPx?: number;
      stepX?: number;
      stepXCss?: number;
      stepDy?: number;
      deviceScaleFactor?: number;
    };
    fixedPan =
      meta.stepXPx ??
      meta.stepX ??
      (meta.stepXCss != null && meta.deviceScaleFactor != null
        ? Math.round(meta.stepXCss * meta.deviceScaleFactor)
        : undefined);
    fixedDy = meta.stepDy ?? 0;
  }

  console.log(`Stitching ${tilePaths.length} tiles (pan=${fixedPan ?? "auto"} dy=${fixedDy})`);
  const stitchedPath = join(outDir, "stitched-row.png");
  const croppedPath = join(outDir, "stitched-row-cropped.png");

  const result = await stitchRowTiles(tilePaths, {
    fixedPan,
    fixedDy,
    expectedStep: fixedPan,
    cropChrome: false,
  });
  writeFileSync(stitchedPath, result.buffer);
  console.log(`\nMerged: ${stitchedPath} (${result.width}×${result.height}px)`);

  let output = result;
  if (crop) {
    const chrome = await detectMapChromeCropMerged(result.buffer);
    const cropped = await sharp(result.buffer)
      .extract({ left: 0, top: chrome.top, width: chrome.width, height: chrome.height })
      .png()
      .toBuffer();
    writeFileSync(croppedPath, cropped);
    output = { ...result, buffer: cropped, width: chrome.width, height: chrome.height, crop: chrome };
    console.log(`Cropped: ${croppedPath} (${chrome.width}×${chrome.height}px)`);
    console.log(`  top=${chrome.top}px  bottom=${chrome.bottom}px (bottom = top × 1.2)`);
  }

  if (scale > 1) {
    const hqPath = join(outDir, hqName);
    const src = crop ? output.buffer : result.buffer;
    const meta = await sharp(src).metadata();
    const hqW = Math.round((meta.width ?? result.width) * scale);
    const hqH = Math.round((meta.height ?? result.height) * scale);
    console.log(`\n── HQ preview ${scale}× → ${hqPath} ──`);
    const hq = await sharp(src)
      .resize(hqW, hqH, { kernel: sharp.kernel.lanczos3 })
      .sharpen({ sigma: 0.6, m1: 0.5, m2: 0.25 })
      .png({ compressionLevel: 1 })
      .toBuffer();
    writeFileSync(hqPath, hq);
    console.log(`  ${hqPath} (${hqW}×${hqH}px)`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
