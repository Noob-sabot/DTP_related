import { readFileSync, writeFileSync } from "fs";
import { PDFDocument } from "pdf-lib";

/** Stitch page PNG/JPEG images into a single multi-page PDF. */
export async function stitchPagesToPdf(pagePaths: string[], outPath: string): Promise<void> {
  const pdf = await PDFDocument.create();

  for (const path of pagePaths) {
    const bytes = readFileSync(path);
    const isPng = bytes[0] === 0x89;
    const image = isPng ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
    const page = pdf.addPage([image.width, image.height]);
    page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
  }

  writeFileSync(outPath, await pdf.save());
}
