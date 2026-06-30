import type { FigJamCaptureConfig } from "./figjam-config.js";

export const DEFAULT_ZOOM_STEPS = 6;
export const DEFAULT_PAGE_COLS = 4;
export const DEFAULT_PAGE_ROWS = 3;
export const DEFAULT_OVERVIEW_ZOOM_OUT_STEPS = 3;
export const DEFAULT_MAX_SEARCH_ATTEMPTS = 10;

export const MAP_NAV_PHASES = ["overview", "search", "zoom-selection", "zoom-readable"] as const;
export type MapNavPhase = (typeof MAP_NAV_PHASES)[number];

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

/** Search queries ordered most-specific first to avoid wrong-map hits (e.g. METRO TRAM). */
export function mapSearchQueries(searchTerm: string): string[] {
  const t = normalizeMapSearchTerm(searchTerm);
  const queries: string[] = [];

  if (t.includes("TOWN BUS")) {
    queries.push("& TOWN BUS", "TOWN BUS");
  } else if (t.includes("METRO TRAM")) {
    queries.push("METRO TRAM");
  } else if (t.includes("V/LINE COACH") || t.includes("VLINE COACH")) {
    queries.push("V/LINE COACH", "COACH");
  } else if (t.includes("V/LINE TRAIN") || t.includes("VLINE TRAIN")) {
    queries.push("V/LINE TRAIN");
  }

  if (!queries.includes(t)) queries.push(t);
  return queries;
}

export function isWrongMapHit(searchTerm: string, ocrText: string): boolean {
  const target = searchTerm.toLowerCase();
  const hay = ocrText.toLowerCase();
  if (!hay.trim()) return false;

  if (target.includes("town bus")) {
    if (hay.includes("metro tram") && !hay.includes("town bus")) return true;
    if ((hay.includes("v/line") || hay.includes("vline")) && !hay.includes("town bus")) return true;
    if (hay.includes("regional bus") && !hay.includes("town bus")) return true;
    if (hay.includes("cpv") && !hay.includes("town bus")) return true;
  }

  if (target.includes("metro tram") && hay.includes("town bus") && !hay.includes("metro tram")) {
    return true;
  }

  return false;
}

export function mapMatchesSearchTerm(ocrText: string, searchTerm: string): boolean {
  if (isWrongMapHit(searchTerm, ocrText)) return false;
  const hay = ocrText.toLowerCase();
  const needles = searchTerm
    .toLowerCase()
    .split(/\s*&\s*|\s+/)
    .filter(Boolean);
  return needles.every((n) => hay.includes(n));
}

export interface MapNavigationPlan {
  phases: readonly MapNavPhase[];
  overviewZoomOutSteps: number;
  searchQueries: string[];
  maxSearchAttempts: number;
  readableZoomInSteps: number;
}

export function buildMapNavigationPlan(searchTerm: string): MapNavigationPlan {
  return {
    phases: MAP_NAV_PHASES,
    overviewZoomOutSteps: DEFAULT_OVERVIEW_ZOOM_OUT_STEPS,
    searchQueries: mapSearchQueries(searchTerm),
    maxSearchAttempts: DEFAULT_MAX_SEARCH_ATTEMPTS,
    readableZoomInSteps: DEFAULT_ZOOM_STEPS,
  };
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
