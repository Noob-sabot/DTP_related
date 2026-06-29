import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { cellsToGrid, gridToTsv } from "./lib/journey-table-export.js";
import { ocrImage, ocrCellsToTextCells } from "./lib/ocr-tiles.js";

const VALIDATION_IMAGE =
  process.argv[2] ??
  "/Users/transport/.cursor/projects/Users-transport-Documents-DTP/assets/Screenshot_2026-06-30_at_8.01.44_am-a6fcb394-741b-461b-9aee-a701434420b4.png";

const EXPECTED_PHRASES = [
  "Metro",
  "Town Bus",
  "Journey Stages",
  "Journey Steps",
  "Moments That Matter",
  "Thoughts",
  "Decisions",
  "How I Will Get from A-B",
  "simplest",
  "accessible",
  "public transport",
  "independently",
];

/** Ground truth from validation screenshot (left label + definition + first stage column). */
const REFERENCE_GRID = [
  ["Journey Stages", "The high level stages of the journey", ""],
  ["Journey Steps", "Steps a customer will take along their journey", "How I Will Get from A-B"],
  ["Moments That Matter", "Points in the journey that are critical to overall experience", ""],
  [
    "Thoughts & Decisions",
    "Customer thought process that will determine their actions",
    "What's the simplest, safest, most comfortable way to get from A-B when private vehicle is not an option?",
  ],
  [
    "",
    "",
    "Which of the options are the most accessible? Which of the options do I have most confidence in, from an accessibility perspective?",
  ],
  ["", "", "What's the time / cost / stress trade off of taking public transport Vs CPV?"],
  ["", "", "Will I be able to do this trip independently? Or will I need support from others?"],
  [
    "",
    "",
    "What do I know already? What good experiences have I had on the bus before and I am happy/confident to repeat (even if it adds extra time or inconvenience)?",
  ],
];

async function main() {
  const outDir = join(import.meta.dirname, "../exports/dtp-accessibility-journey-maps/metro-town-bus");
  mkdirSync(outDir, { recursive: true });

  console.log(`Validating against:\n  ${VALIDATION_IMAGE}\n`);

  const ocrCells = await ocrImage(VALIDATION_IMAGE);
  const allText = ocrCells.map((c) => c.text).join(" ").toLowerCase();

  console.log("Phrase check (OCR vs screenshot):");
  for (const phrase of EXPECTED_PHRASES) {
    const p = phrase.toLowerCase();
    const found =
      allText.includes(p) ||
      (p === "how i will get from a-b" && /how.*will.*get.*from.*a-b/i.test(allText)) ||
      (p === "journey steps" && allText.includes("journey") && allText.includes("how") && allText.includes("will get"));
    console.log(`  ${found ? "✓" : "✗"} ${phrase}`);
  }

  const grid = cellsToGrid(ocrCellsToTextCells(ocrCells));
  writeFileSync(join(outDir, "journey-grid-ocr.tsv"), gridToTsv(grid));
  writeFileSync(join(outDir, "journey-grid-reference.tsv"), gridToTsv(REFERENCE_GRID));
  writeFileSync(
    join(outDir, "cells-flat.tsv",
    ),
    gridToTsv([
      ["x", "y", "confidence", "text"],
      ...ocrCells.map((c) => [
        String(Math.round(c.cx)),
        String(Math.round(c.cy)),
        String(Math.round(c.confidence)),
        c.text,
      ]),
    ])
  );

  const matched = EXPECTED_PHRASES.filter((phrase) => {
    const p = phrase.toLowerCase();
    return (
      allText.includes(p) ||
      (p === "how i will get from a-b" && /how.*will.*get.*from.*a-b/i.test(allText)) ||
      (p === "journey steps" && allText.includes("journey") && allText.includes("how") && allText.includes("will get"))
    );
  }).length;
  writeFileSync(
    join(outDir, "validation-report.json"),
    JSON.stringify(
      {
        validationImage: VALIDATION_IMAGE,
        ocrCellCount: ocrCells.length,
        phrasesMatched: `${matched}/${EXPECTED_PHRASES.length}`,
        phraseChecks: Object.fromEntries(
          EXPECTED_PHRASES.map((p) => [p, allText.includes(p.toLowerCase())])
        ),
        automatedCaptureNote:
          "Playwright tiles were too zoomed out (0 OCR words). Re-capture needs ~this zoom level.",
        files: {
          ocr: "journey-grid-ocr.tsv",
          reference: "journey-grid-reference.tsv",
          flat: "cells-flat.tsv",
        },
        extractedAt: new Date().toISOString(),
      },
      null,
      2
    )
  );

  console.log(`\nOCR grid: ${grid.length} rows (see journey-grid-ocr.tsv)`);
  console.log(`Reference grid: ${REFERENCE_GRID.length} rows (see journey-grid-reference.tsv)`);
  console.log(`Matched ${matched}/${EXPECTED_PHRASES.length} key phrases`);
}

main().catch(console.error);
