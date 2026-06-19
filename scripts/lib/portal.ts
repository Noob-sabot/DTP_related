import type { Page } from "@playwright/test";
import type { DayEntry } from "./config.js";

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export async function dismissInfoDialog(page: Page): Promise<void> {
  const ok = page.getByRole("button", { name: "OK" });
  if (await ok.isVisible({ timeout: 2000 }).catch(() => false)) {
    await ok.click();
    await page.waitForTimeout(500);
  }
}

export async function navigateToWeekGrid(
  page: Page,
  periodMatch: string,
  contractAssignment: string
): Promise<void> {
  await dismissInfoDialog(page);

  const contract = page.getByRole("combobox", { name: /Contract Assignment/i });
  if (await contract.isVisible({ timeout: 3000 }).catch(() => false)) {
    const value = await contract.inputValue();
    if (!value.includes(contractAssignment)) {
      throw new Error(`Expected contract ${contractAssignment}, got ${value}`);
    }

    const periodSelect = page.getByRole("combobox", {
      name: /Select Timesheet Period/i,
    });
    const options = await periodSelect.locator("option").allTextContents();
    const matchIdx = options.findIndex((o) => o.includes(periodMatch));
    if (matchIdx < 0) {
      throw new Error(
        `Period "${periodMatch}" not found. Options: ${options.join(", ")}`
      );
    }
    await periodSelect.selectOption({ index: matchIdx });
    await page.getByRole("button", { name: "Next" }).click();
    await page.waitForTimeout(2000);
  }

  await page.getByRole("button", { name: "Edit" }).first().waitFor({
    timeout: 15000,
  });
}

async function fillDayDetail(
  page: Page,
  day: DayEntry,
  dayIndex: number
): Promise<void> {
  console.log(`  ${DAY_NAMES[dayIndex]}: ${day.hours}h`);

  await page.getByRole("button", { name: "Edit" }).nth(dayIndex).click();
  await page.getByRole("textbox", { name: "startTime" }).waitFor({
    timeout: 10000,
  });

  if (day.hours === 0) {
    await page.getByRole("textbox", { name: "startTime" }).fill("00:00");
    await page.getByRole("textbox", { name: "endTime" }).fill("00:00");
    await page.getByRole("textbox", { name: "nonWorkedTime" }).fill("00:00");
  } else {
    await page.getByRole("textbox", { name: "startTime" }).fill(day.start!);
    await page.getByRole("textbox", { name: "endTime" }).fill(day.end!);
    await page.getByRole("textbox", { name: "nonWorkedTime" }).fill(day.break!);
    const desc = page.getByRole("textbox", { name: "description" });
    if (day.note) {
      await desc.fill(day.note);
    } else {
      await desc.click();
    }
  }

  await page.getByRole("button", { name: "OK" }).click();
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: "Edit" }).first().waitFor({
    timeout: 10000,
  });
}

export async function fillWeek(
  page: Page,
  days: DayEntry[]
): Promise<void> {
  if (days.length !== 7) {
    throw new Error(`Expected 7 days (Mon–Sun), got ${days.length}`);
  }

  for (let i = 0; i < 7; i++) {
    await fillDayDetail(page, days[i], i);
  }
}

export async function saveTimesheet(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Save" }).click();
  await page.waitForTimeout(2000);
  await dismissInfoDialog(page);
  console.log("Timesheet saved.");
}

export async function submitTimesheet(page: Page): Promise<void> {
  const submitBtn = page.getByRole("button", { name: "Submit for Approval" });
  if (await submitBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await submitBtn.click();
    await page.waitForTimeout(2000);
    await dismissInfoDialog(page);
    console.log("Timesheet submitted for approval.");
    return;
  }

  await navigateToWeekGridFromPeriod(page);
  await submitBtn.click();
  await page.waitForTimeout(2000);
  await dismissInfoDialog(page);
  console.log("Timesheet submitted for approval.");
}

async function navigateToWeekGridFromPeriod(page: Page): Promise<void> {
  const next = page.getByRole("button", { name: "Next" });
  if (await next.isVisible({ timeout: 2000 }).catch(() => false)) {
    await next.click();
    await page.waitForTimeout(2000);
  }
}

export async function verifyWeekGrid(
  page: Page,
  days: DayEntry[]
): Promise<void> {
  const inputs = page.locator('input[disabled][readonly]');
  const count = await inputs.count();
  const hourFields: string[] = [];
  for (let i = 0; i < Math.min(count, 7); i++) {
    hourFields.push(await inputs.nth(i).inputValue());
  }

  console.log("Week grid:", hourFields.join(" | "));
  for (let i = 0; i < 7; i++) {
    const expected = String(days[i].hours);
    const actual = hourFields[i] ?? "?";
    if (actual !== expected && days[i].hours !== 0) {
      console.warn(`  ${DAY_NAMES[i]}: expected ${expected}, got ${actual}`);
    }
  }
}
