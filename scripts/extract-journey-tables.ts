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
    all: argv.includes("--all"),
    format: getValue("--format") ?? "tsv",
  };
}

function extractSection(
  section: FigmaNode,
  mapName: string,
  outputDir: string,
  format: string
): { gridPath: string; flatPath: string; manifestPath: string } {
  const baseName = slugify(mapName);
  const mapDir = join(outputDir, baseName);
  mkdirSync(mapDir, { recursive: true });

  const bounds = section.absoluteBoundingBox!;
  const textCells = collectTextCells(section, bounds);

  const nativeTables: FigmaNode[] = [];
  walkNodes(section, (node) => {
    if (node.type === "TABLE") nativeTables.push(node);
  });

  const serialize = format === "csv" ? gridToCsv : gridToTsv;
  const ext = format;

  if (nativeTables.length > 0) {
    nativeTables.forEach((table, i) => {
      const grid = exportTableNode(table);
      writeFileSync(join(mapDir, `table-${i + 1}.${ext}`), serialize(grid));
    });
  }

  const grid = cellsToGrid(textCells);
  const gridPath = join(mapDir, `journey-grid.${ext}`);
  writeFileSync(gridPath, serialize(grid));

  const flatPath = join(mapDir, `cells-flat.${ext}`);
  writeFileSync(flatPath, serialize(cellsToFlatTable(textCells)));

  const manifestPath = join(mapDir, "manifest.json");
  writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        mapName: section.name,
        sectionId: section.id,
        textCellCount: textCells.length,
        gridRows: grid.length,
        gridCols: grid[0]?.length ?? 0,
        nativeTables: nativeTables.length,
        files: { gridPath, flatPath },
        extractedAt: new Date().toISOString(),
      },
      null,
      2
    )
  );

  return { gridPath, flatPath, manifestPath };
}

async function main() {
  const config = loadFigJamConfig();
  const args = parseArgs(process.argv.slice(2));
  const outputDir = resolveOutputDir(config);

  console.log("Loading FigJam file...");
  const file = await fetchFigmaFile();
  const sections = findSections(file.document);

  if (args.list) {
    console.log(`\nFound ${sections.length} sections:\n`);
    for (const s of sections) {
      console.log(`  - ${s.name} (id: ${s.id})`);
    }
    return;
  }

  const format = args.format === "csv" ? "csv" : "tsv";

  if (args.all) {
    console.log(`Extracting ${sections.length} sections...\n`);
    for (const section of sections) {
      if (!section.absoluteBoundingBox) {
        console.warn(`  Skip "${section.name}" — no bounding box`);
        continue;
      }
      console.log(`Extracting: "${section.name}"`);
      const { gridPath } = extractSection(section, section.name, outputDir, format);
      console.log(`  → ${gridPath}\n`);
    }
    console.log(`Done. Output folder:\n  ${outputDir}`);
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
  const { gridPath } = extractSection(section, mapName, outputDir, format);
  console.log(`\nDone. Open in Excel:\n  ${gridPath}`);
  console.log("Tip: TSV pastes cleanly into Excel (one tab per cell).");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
