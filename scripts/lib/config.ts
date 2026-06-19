import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "../..");

export interface DayEntry {
  hours: number;
  start?: string;
  end?: string;
  break?: string;
  note?: string;
}

export interface TimesheetConfig {
  portalUrl: string;
  timesheetPath: string;
  contractAssignment: string;
  organisation: string;
  defaults: {
    startTime: string;
    endTime: string;
    breakTime: string;
    expectedHours: number;
    rate: string;
    workDays: string[];
  };
  currentWeek: {
    periodMatch: string;
    days: DayEntry[];
  };
}

export function loadConfig(): TimesheetConfig {
  const path = join(rootDir, "timesheet-config.json");
  return JSON.parse(readFileSync(path, "utf-8")) as TimesheetConfig;
}

export function getTimesheetUrl(config: TimesheetConfig): string {
  const origin = new URL(config.portalUrl).origin;
  return `${origin}${config.timesheetPath}`;
}

export const AUTH_STATE_PATH = join(rootDir, "auth-state.json");

export function requireAuthState(): string {
  if (!existsSync(AUTH_STATE_PATH)) {
    console.error("auth-state.json not found. Run: npm run auth");
    process.exit(1);
  }
  return AUTH_STATE_PATH;
}

export function parseArgs(argv: string[]) {
  return {
    headed: argv.includes("--headed"),
    submit: argv.includes("--submit"),
    period: argv.find((a, i) => argv[i - 1] === "--period"),
  };
}
