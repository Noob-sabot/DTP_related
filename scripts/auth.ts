import { chromium } from "@playwright/test";
import { loadConfig, AUTH_STATE_PATH } from "./lib/config.js";

async function main() {
  const config = loadConfig();

  console.log("Opening portal for manual login...");
  console.log("Complete login + Gmail OTP, then click Resume in Playwright inspector.");

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(config.portalUrl);
  await page.pause();

  await context.storageState({ path: AUTH_STATE_PATH });
  console.log(`Saved session to ${AUTH_STATE_PATH}`);

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
