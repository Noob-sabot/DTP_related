import { createScheduler, createWorker } from "tesseract.js";
import { ocrImage, parseTsv, preprocessForOcr, type OcrCell } from "./ocr-tiles.js";

export interface PagePosition {
  row: number;
  col: number;
  offsetX: number;
  offsetY: number;
}

export interface PageOcrResult {
  position: PagePosition;
  cells: OcrCell[];
  imagePath: string;
}

export class OcrQueue {
  private scheduler: Awaited<ReturnType<typeof createScheduler>> | null = null;
  private jobs: Promise<PageOcrResult>[] = [];

  constructor(private workerCount = 1) {}

  async start(): Promise<void> {
    this.scheduler = createScheduler();
    for (let i = 0; i < this.workerCount; i++) {
      const worker = await createWorker("eng");
      this.scheduler.addWorker(worker);
    }
  }

  async stop(): Promise<void> {
    if (this.scheduler) {
      await this.scheduler.terminate();
      this.scheduler = null;
    }
    this.jobs = [];
  }

  /** Run OCR immediately (used to verify first page before background queue). */
  async recognizePage(imagePath: string, position: PagePosition): Promise<PageOcrResult> {
    const cells = await ocrImage(imagePath, position.offsetX, position.offsetY);
    return { position, cells, imagePath };
  }

  /** Enqueue OCR without blocking the caller. */
  enqueue(imagePath: string, position: PagePosition): Promise<PageOcrResult> {
    const job = this.runJob(imagePath, position);
    this.jobs.push(job);
    return job;
  }

  async drain(): Promise<PageOcrResult[]> {
    return Promise.all(this.jobs);
  }

  private async runJob(imagePath: string, position: PagePosition): Promise<PageOcrResult> {
    if (this.scheduler) {
      const image = await preprocessForOcr(imagePath, 2);
      const { data } = await this.scheduler.addJob("recognize", image, {}, { tsv: true });
      const cells = parseTsv(data.tsv ?? "", position.offsetX, position.offsetY).map((c) => ({
        ...c,
        x: c.x / 2,
        y: c.y / 2,
        cx: c.cx / 2,
        cy: c.cy / 2,
      }));
      return { position, cells, imagePath };
    }

    return this.recognizePage(imagePath, position);
  }
}

/** @deprecated use OcrQueue */
export async function ocrAllTilesBackground(
  tiles: Array<{ path: string; row: number; col: number; offsetX: number; offsetY: number }>
): Promise<PageOcrResult[]> {
  const queue = new OcrQueue(2);
  await queue.start();
  for (const t of tiles) {
    queue.enqueue(t.path, { row: t.row, col: t.col, offsetX: t.offsetX, offsetY: t.offsetY });
  }
  const results = await queue.drain();
  await queue.stop();
  return results;
}
