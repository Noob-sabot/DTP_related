import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import sharp from "sharp";
import { ocrImage } from "./lib/ocr-tiles.js";

const ROW_DIR = join(import.meta.dirname, "../exports/dtp-accessibility-journey-maps/auto-row");
const NATIVE = join(ROW_DIR, "stitched-row.png");
const HQ = join(ROW_DIR, "stitched-row-hq.png");
const OUT = join(ROW_DIR, "ocr-compare");

const STRIP_W = 1920;
const STRIP_STEP = 1302;
const CONTENT_TOP = 90;
const CONTENT_H = 880;

function normalizeText(cells: { text: string }[]): string[] {
  return cells
    .map((c) => c.text.trim().toLowerCase())
    .filter((t) => t.length >= 3)
    .map((t) => t.replace(/\s+/g, " "));
}

function wordSet(texts: string[]): Set<string> {
  const words = new Set<string>();
  for (const t of texts) {
    for (const w of t.split(/[^a-z0-9'-]+/i)) {
      if (w.length >= 3) words.add(w.toLowerCase());
    }
  }
  return words;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  const union = a.size + b.size - inter;
  return union > 0 ? inter / union : 1;
}

async function extractStrip(
  src: string,
  left: number,
  top: number,
  width: number,
  height: number,
  outPath: string
): Promise<void> {
  const meta = await sharp(src).metadata();
  const w = meta.width ?? 1920;
  const h = meta.height ?? 1080;
  const clipW = Math.min(width, w - left);
  const clipH = Math.min(height, h - top);
  if (clipW < 200) return;
  await sharp(src)
    .extract({ left, top, width: clipW, height: clipH })
    .png()
    .toFile(outPath);
}

async function ocrStrips(imagePath: string, scaleFactor: number, label: string) {
  const meta = await sharp(imagePath).metadata();
  const w = meta.width ?? 1920;
  const h = meta.height ?? 1080;
  const top = Math.round(CONTENT_TOP * scaleFactor);
  const stripH = Math.round(CONTENT_H * scaleFactor);
  const stripW = Math.round(STRIP_W * scaleFactor);
  const step = Math.round(STRIP_STEP * scaleFactor);

  const strips: Array<{ index: number; left: number; path: string; cells: Awaited<ReturnType<typeof ocrImage>> }> = [];
  mkdirSync(join(OUT, label), { recursive: true });

  let i = 0;
  for (let left = 0; left < w - 400; left += step) {
    const path = join(OUT, label, `strip-${String(i).padStart(2, "0")}.png`);
    await extractStrip(imagePath, left, top, stripW, stripH, path);
    try {
      const cells = await ocrImage(path, left / scaleFactor, top / scaleFactor, 2);
      strips.push({ index: i, left, path, cells });
      console.log(`  ${label} strip ${i} @${left}: ${cells.length} cells`);
    } catch (e) {
      console.log(`  ${label} strip ${i} failed: ${e}`);
    }
    i++;
  }
  return strips;
}

async function main() {
  mkdirSync(OUT, { recursive: true });

  console.log("OCR resolution compare: native vs HQ (3× upscale)\n");
  console.log("Native:", NATIVE);
  console.log("HQ:    ", HQ);

  console.log("\n── Native strips ──");
  const native = await ocrStrips(NATIVE, 1, "native");

  console.log("\n── HQ strips ──");
  const hq = await ocrStrips(HQ, 3, "hq");

  const nativeTexts = normalizeText(native.flatMap((s) => s.cells));
  const hqTexts = normalizeText(hq.flatMap((s) => s.cells));
  const nativeWords = wordSet(nativeTexts);
  const hqWords = wordSet(hqTexts);

  const onlyNative = [...nativeWords].filter((w) => !hqWords.has(w)).sort();
  const onlyHq = [...hqWords].filter((w) => !nativeWords.has(w)).sort();
  const overlap = jaccard(nativeWords, hqWords);

  const report = {
    native: { strips: native.length, cells: nativeTexts.length, uniqueWords: nativeWords.size },
    hq: { strips: hq.length, cells: hqTexts.length, uniqueWords: hqWords.size },
    wordJaccard: overlap,
    onlyNative: onlyNative.slice(0, 40),
    onlyHq: onlyHq.slice(0, 40),
    sampleNative: nativeTexts.slice(0, 15),
    sampleHq: hqTexts.slice(0, 15),
  };

  writeFileSync(join(OUT, "compare.json"), JSON.stringify(report, null, 2));
  writeFileSync(join(OUT, "native-words.txt"), [...nativeWords].sort().join("\n"));
  writeFileSync(join(OUT, "hq-words.txt"), [...hqWords].sort().join("\n"));

  console.log("\n── Summary ──");
  console.log(`  Native: ${nativeWords.size} unique words (${nativeTexts.length} text cells)`);
  console.log(`  HQ:     ${hqWords.size} unique words (${hqTexts.length} text cells)`);
  console.log(`  Word overlap (Jaccard): ${(overlap * 100).toFixed(1)}%`);
  console.log(`  Only in native: ${onlyNative.length} words`);
  console.log(`  Only in HQ:     ${onlyHq.length} words`);
  if (onlyNative.length) console.log(`    e.g. ${onlyNative.slice(0, 8).join(", ")}`);
  if (onlyHq.length) console.log(`    e.g. ${onlyHq.slice(0, 8).join(", ")}`);
  console.log(`\nFull report: ${join(OUT, "compare.json")}`);

  const same = overlap >= 0.92 && onlyNative.length <= 15 && onlyHq.length <= 15;
  console.log(
    same
      ? "\n→ OCR results are effectively the same — native resolution is fine for on-screen work."
      : "\n→ OCR differs meaningfully — HQ upscale may help (or strips need tuning)."
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
