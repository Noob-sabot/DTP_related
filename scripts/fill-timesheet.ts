import { chromium } from "@playwright/test";
import {
  loadConfig,
  getTimesheetUrl,
  requireAuthState,
  parseArgs,
} from "./lib/config.js";
import {
  navigateToWeekGrid,
  fillWeek,
  saveTimesheet,
  submitTimesheet,
  verifyWeekGrid,
} from "./lib/portal.js";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = loadConfig();
  const authPath = requireAuthState();
  const periodMatch = args.period ?? config.currentWeek.periodMatch;

  console.log(`Filling timesheet for period: ${periodMatch}`);

  const browser = await chromium.launch({ headless: !args.headed });
  const context = await browser.newContext({ storageState: authPath });
  const page = await context.newPage();

  await page.goto(getTimesheetUrl(config));

  const onLoginPage =
    page.url().includes("/login") ||
    (await page
      .getByRole("button", { name: "Login" })
      .isVisible({ timeout: 5000 })
      .catch(() => false));
  if (onLoginPage) {
    console.error("Session expired. Run: npm run auth");
    await browser.close();
    process.exit(1);
  }

  await navigateToWeekGrid(
    page,
    periodMatch,
    config.contractAssignment
  );

  console.log("Filling days...");
  await fillWeek(page, config.currentWeek.days);

  await verifyWeekGrid(page, config.currentWeek.days);
  await saveTimesheet(page);

  if (args.submit) {
    await page.goto(getTimesheetUrl(config));
    await navigateToWeekGrid(
      page,
      periodMatch,
      config.contractAssignment
    );
    await submitTimesheet(page);
  } else {
    console.log("Not submitting (pass --submit to submit for approval).");
  }

  await browser.close();
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
