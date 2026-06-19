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

  const editButtons = page.getByRole("button", { name: "Edit" });
  if (await editButtons.first().isVisible({ timeout: 2000 }).catch(() => false)) {
    return;
  }

  const combos = page.getByRole("combobox");
  const contract = combos.first();
  await contract.waitFor({ timeout: 10000 });

  const contractText =
    (await contract.locator("option:checked").textContent())?.trim() ?? "";
  if (!contractText.includes(contractAssignment)) {
    throw new Error(
      `Expected contract ${contractAssignment}, got ${contractText || "(empty)"}`
    );
  }

  const periodSelect = combos.nth(1);
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

  await editButtons.first().waitFor({
    timeout: 15000,
  });
}

async function setTimeField(
  page: Page,
  name: string,
  value: string
): Promise<void> {
  const field = page.getByRole("textbox", { name });
  await field.click();
  await field.press("ControlOrMeta+a");
  await field.press("Backspace");
  await field.fill(value);
  await page.waitForTimeout(400);
}

async function waitForHours(page: Page, expected: number): Promise<void> {
  const hours = page.getByRole("textbox", { name: "hours" });
  const targets = new Set([String(expected), `${expected}.0`]);

  for (let i = 0; i < 30; i++) {
    const val = await hours.inputValue();
    if (targets.has(val)) return;
    await page.waitForTimeout(200);
  }

  const val = await hours.inputValue();
  throw new Error(`Hours not recalculated: expected ${expected}, got ${val}`);
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

  const rate = page.getByRole("combobox").first();
  if (await rate.isVisible({ timeout: 1000 }).catch(() => false)) {
    await rate.selectOption({ label: "Consulting Fee" });
    await page.waitForTimeout(300);
  }

  if (day.hours === 0) {
    await setTimeField(page, "startTime", "00:00");
    await setTimeField(page, "endTime", "00:00");
    await setTimeField(page, "nonWorkedTime", "00:00");
    const desc = page.getByRole("textbox", { name: "description" });
    await desc.click();
    await desc.press("ControlOrMeta+a");
    await desc.fill("");
  } else {
    // Fill end before start when recovering from zeroed 09:00–00:00 rows.
    await setTimeField(page, "endTime", day.end!);
    await setTimeField(page, "startTime", day.start!);
    await setTimeField(page, "nonWorkedTime", day.break!);

    const desc = page.getByRole("textbox", { name: "description" });
    if (day.note) {
      await desc.click();
      await desc.press("ControlOrMeta+a");
      await desc.fill(day.note);
    } else {
      await desc.click();
    }

    await waitForHours(page, day.hours);

    const endVal = await page.getByRole("textbox", { name: "endTime" }).inputValue();
    if (endVal !== day.end) {
      throw new Error(
        `${DAY_NAMES[dayIndex]} endTime mismatch before OK: expected ${day.end}, got ${endVal}`
      );
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
  const gridHours = page.locator(
    'input[readonly]:not([name="timeWorked"]):not([name="hours"])'
  );
  const editCount = await page.getByRole("button", { name: "Edit" }).count();
  const hourFields: string[] = [];

  for (let i = 0; i < editCount; i++) {
    const edit = page.getByRole("button", { name: "Edit" }).nth(i);
    const hourInput = edit.locator("xpath=preceding::input[@readonly][1]");
    hourFields.push(await hourInput.inputValue().catch(() => "?"));
  }

  if (hourFields.length === 0) {
    const readonly = page.getByRole("textbox", { disabled: true });
    const count = await readonly.count();
    for (let i = 0; i < Math.min(count, 7); i++) {
      hourFields.push(await readonly.nth(i).inputValue());
    }
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
