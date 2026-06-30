import { join } from "path";
import { writeFileSync } from "fs";
import { loadFigJamConfig, resolveOutputDir, slugify } from "./lib/figjam-config.js";
import { resolveMapSearchTerm } from "./lib/journey-map-pipeline.js";
import { writeStitchedPages } from "./lib/stitch-pages.js";

function parseArgs(argv: string[]) {
  return {
    name: argv.find((a, i) => argv[i - 1] === "--name"),
    pagesDir: argv.find((a, i) => argv[i - 1] === "--pages-dir"),
    overlap: Number(argv.find((a, i) => argv[i - 1] === "--overlap") ?? NaN),
    out: argv.find((a, i) => argv[i - 1] === "--out"),
    fixed: argv.includes("--fixed-overlap"),
  };
}

async function main() {
  const config = loadFigJamConfig();
  const args = parseArgs(process.argv.slice(2));
  const searchTerm = resolveMapSearchTerm(args.name, config);
  const baseName = slugify(searchTerm);
  const mapDir = join(resolveOutputDir(config), baseName);
  const pagesDir = args.pagesDir ?? join(mapDir, "pages");
  const overlapPx = Number.isFinite(args.overlap) ? args.overlap : config.tileOverlapPx;
  const outPath = args.out ?? join(mapDir, "stitched.png");

  console.log(`Stitching pages from:\n  ${pagesDir}`);
  console.log(`  mode: ${args.fixed ? "fixed overlap" : "pixel-aligned"}`);
  if (args.fixed) console.log(`  overlap: ${overlapPx}px`);

  const result = await writeStitchedPages(pagesDir, outPath, {
    overlapPx,
    deviceScaleFactor: 1,
    align: !args.fixed,
  });

  if (result.alignment) {
    const manifest = join(mapDir, "stitch-alignment.json");
    writeFileSync(
      manifest,
      JSON.stringify(
        {
          horizontalOverlaps: result.alignment.horizontalOverlaps,
          verticalOverlaps: result.alignment.verticalOverlaps,
          positions: result.alignment.positions,
          outputSize: { width: result.width, height: result.height },
        },
        null,
        2
      )
    );
    console.log(`  alignment log: ${manifest}`);
    console.log(`  row 0 horizontal overlaps: ${result.alignment.horizontalOverlaps[0].slice(1).join(", ")}px`);
  }

  console.log(
    `\nDone: ${result.outPath}\n  grid: ${result.cols}×${result.rows}\n  size: ${result.width}×${result.height}px`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
