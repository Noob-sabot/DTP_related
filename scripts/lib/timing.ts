import { writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";

export interface TimingEntry {
  label: string;
  ms: number;
  meta?: Record<string, string | number | boolean>;
}

export interface TimingLabelStats {
  label: string;
  count: number;
  totalMs: number;
  avgMs: number;
  pct: number;
}

export interface TimingReport {
  totalMs: number;
  entries: TimingEntry[];
  byLabel: TimingLabelStats[];
}

export function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(2)}s`;
  const m = Math.floor(ms / 60_000);
  const s = ((ms % 60_000) / 1000).toFixed(1);
  return `${m}m ${s}s`;
}

export class TimingSession {
  private readonly started = performance.now();
  readonly entries: TimingEntry[] = [];

  async timed<T>(
    label: string,
    fn: () => Promise<T>,
    meta?: Record<string, string | number | boolean>
  ): Promise<T> {
    const t0 = performance.now();
    try {
      return await fn();
    } finally {
      this.record(label, performance.now() - t0, meta);
    }
  }

  syncTimed<T>(label: string, fn: () => T, meta?: Record<string, string | number | boolean>): T {
    const t0 = performance.now();
    try {
      return fn();
    } finally {
      this.record(label, performance.now() - t0, meta);
    }
  }

  record(label: string, ms: number, meta?: Record<string, string | number | boolean>): void {
    this.entries.push({ label, ms, meta });
    const metaStr = meta ? ` ${JSON.stringify(meta)}` : "";
    console.log(`  [timing] ${label}: ${formatMs(ms)}${metaStr}`);
  }

  report(): TimingReport {
    const totalMs = performance.now() - this.started;
    const sums = new Map<string, { count: number; totalMs: number }>();
    for (const e of this.entries) {
      const cur = sums.get(e.label) ?? { count: 0, totalMs: 0 };
      cur.count++;
      cur.totalMs += e.ms;
      sums.set(e.label, cur);
    }
    const trackedMs = [...sums.values()].reduce((s, v) => s + v.totalMs, 0);
    const byLabel = [...sums.entries()]
      .map(([label, { count, totalMs: sum }]) => ({
        label,
        count,
        totalMs: sum,
        avgMs: sum / count,
        pct: trackedMs > 0 ? (sum / trackedMs) * 100 : 0,
      }))
      .sort((a, b) => b.totalMs - a.totalMs);
    return { totalMs, entries: [...this.entries], byLabel };
  }

  printSummary(title = "Timing summary"): void {
    const { totalMs, byLabel } = this.report();
    console.log(`\n── ${title} (wall ${formatMs(totalMs)}) ──`);
    for (const row of byLabel) {
      const countStr = row.count > 1 ? ` ×${row.count} avg ${formatMs(row.avgMs)}` : "";
      console.log(`  ${row.label}: ${formatMs(row.totalMs)} (${row.pct.toFixed(1)}%)${countStr}`);
    }
  }

  writeReport(path: string): TimingReport {
    const report = this.report();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(report, null, 2));
    return report;
  }
}

let active: TimingSession | null = null;

export function startTimingSession(): TimingSession {
  active = new TimingSession();
  return active;
}

export function getTimingSession(): TimingSession | null {
  return active;
}

function ensureSession(): TimingSession {
  if (!active) active = new TimingSession();
  return active;
}

export async function timed<T>(
  label: string,
  fn: () => Promise<T>,
  meta?: Record<string, string | number | boolean>
): Promise<T> {
  return ensureSession().timed(label, fn, meta);
}

export function syncTimed<T>(
  label: string,
  fn: () => T,
  meta?: Record<string, string | number | boolean>
): T {
  return ensureSession().syncTimed(label, fn, meta);
}

export function finishTiming(outPath?: string, title?: string): TimingReport | null {
  if (!active) return null;
  if (title) active.printSummary(title);
  const report = outPath ? active.writeReport(outPath) : active.report();
  active = null;
  return report;
}
