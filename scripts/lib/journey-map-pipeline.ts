import type { FigJamCaptureConfig } from "./figjam-config.js";

export const DEFAULT_ZOOM_STEPS = 8;
export const DEFAULT_PAGE_COLS = 4;
export const DEFAULT_PAGE_ROWS = 3;

export function normalizeMapSearchTerm(name: string): string {
  return name.trim().replace(/\s+/g, " ").toUpperCase();
}

export function resolveMapSearchTerm(
  name: string | undefined,
  config: Pick<FigJamCaptureConfig, "pilotSearchTerm" | "pilotMapName">
): string {
  if (name) return normalizeMapSearchTerm(name);
  return config.pilotSearchTerm ?? normalizeMapSearchTerm(config.pilotMapName);
}

export function mapMatchesSearchTerm(ocrText: string, searchTerm: string): boolean {
  const hay = ocrText.toLowerCase();
  const needles = searchTerm
    .toLowerCase()
    .split(/\s*&\s*|\s+/)
    .filter(Boolean);
  return needles.every((n) => hay.includes(n));
}

export interface PagePlanEntry {
  row: number;
  col: number;
  /** Pan delta from previous page (hand-tool drag distance). */
  panDeltaX: number;
  panDeltaY: number;
}

export interface PageCapturePlan {
  pages: PagePlanEntry[];
  stepX: number;
  stepY: number;
  cols: number;
  rows: number;
}

export function buildPageCapturePlan(opts: {
  cols: number;
  rows: number;
  viewportWidth: number;
  viewportHeight: number;
  overlapPx: number;
}): PageCapturePlan {
  const stepX = opts.viewportWidth - opts.overlapPx;
  const stepY = opts.viewportHeight - opts.overlapPx;
  const pages: PagePlanEntry[] = [];

  for (let row = 0; row < opts.rows; row++) {
    for (let col = 0; col < opts.cols; col++) {
      pages.push({
        row,
        col,
        panDeltaX: col > 0 ? stepX : 0,
        panDeltaY: row > 0 && col === 0 ? stepY : 0,
      });
    }
  }

  return { pages, stepX, stepY, cols: opts.cols, rows: opts.rows };
}
