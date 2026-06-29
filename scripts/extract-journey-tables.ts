import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { loadFigJamConfig, resolveOutputDir, slugify } from "./lib/figjam-config.js";
import {
  fetchFigmaFile,
  findSections,
  sectionMatches,
  collectTextCells,
  exportTableNode,
  walkNodes,
  type FigmaNode,
} from "./lib/figma-api.js";
import { cellsToGrid, gridToTsv, gridToCsv, cellsToFlatTable } from "./lib/journey-table-export.js";

function parseArgs(argv: string[]) {
  const getValue = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return {
    name: getValue("--name"),
    list: argv.includes("--list"),
    format: getValue("--format") ?? "tsv",
  };
}

async function main() {
  const config = loadFigJamConfig();
  const args = parseArgs(process.argv.slice(2));
  const outputDir = resolveOutputDir(config);

  console.log("Fetching FigJam file from Figma API...");
  const file = await fetchFigmaFile();
  const sections = findSections(file.document);

  if (args.list) {
    console.log(`\nFound ${sections.length} sections:\n`);
    for (const s of sections) {
      console.log(`  - ${s.name} (id: ${s.id})`);
    }
    return;
  }

  const mapName = args.name ?? config.pilotMapName;
  const section = sections.find((s) => sectionMatches(s, mapName));
  if (!section) {
    console.error(`No section matching "${mapName}". Run with --list to see section names.`);
    process.exit(1);
  }

  if (!section.absoluteBoundingBox) {
    console.error(`Section "${section.name}" has no bounding box.`);
    process.exit(1);
  }

  console.log(`Extracting: "${section.name}" (${section.id})`);
  const baseName = slugify(mapName);
  const mapDir = join(outputDir, baseName);
  mkdirSync(mapDir, { recursive: true });

  const bounds = section.absoluteBoundingBox;
  const textCells = collectTextCells(section, bounds);
  console.log(`  Found ${textCells.length} text cells`);

  const nativeTables: FigmaNode[] = [];
  walkNodes(section, (node) => {
    if (node.type === "TABLE") nativeTables.push(node);
  });

  const format = args.format === "csv" ? "csv" : "tsv";
  const serialize = format === "csv" ? gridToCsv : gridToTsv;
  const ext = format;

  if (nativeTables.length > 0) {
    console.log(`  Found ${nativeTables.length} native FigJam TABLE node(s)`);
    nativeTables.forEach((table, i) => {
      const grid = exportTableNode(table);
      const path = join(mapDir, `table-${i + 1}.${ext}`);
      writeFileSync(path, serialize(grid));
      console.log(`  Wrote ${path} (${grid.length} rows)`);
    });
  }

  const grid = cellsToGrid(textCells);
  const gridPath = join(mapDir, `journey-grid.${ext}`);
  writeFileSync(gridPath, serialize(grid));
  console.log(`  Wrote ${gridPath} (${grid.length} rows × ${grid[0]?.length ?? 0} cols)`);

  const flatPath = join(mapDir, `cells-flat.${ext}`);
  writeFileSync(flatPath, serialize(cellsToFlatTable(textCells)));

  const manifest = {
    mapName: section.name,
    sectionId: section.id,
    textCellCount: textCells.length,
    gridRows: grid.length,
    gridCols: grid[0]?.length ?? 0,
    nativeTables: nativeTables.length,
    files: { gridPath, flatPath },
    extractedAt: new Date().toISOString(),
  };
  writeFileSync(join(mapDir, "manifest.json"), JSON.stringify(manifest, null, 2));

  console.log(`\nDone. Open in Excel:\n  ${gridPath}`);
  console.log("Tip: TSV pastes cleanly into Excel (one tab per cell).");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
