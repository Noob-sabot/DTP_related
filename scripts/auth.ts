import { chromium } from "@playwright/test";
import { loadConfig, AUTH_STATE_PATH } from "./lib/config.js";

async function main() {
  const config = loadConfig();

  console.log("Opening portal for manual login...");

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(config.portalUrl);

  if (process.argv.includes("--pause")) {
    console.log("Complete login + Gmail OTP, then click Resume in Playwright inspector.");
    await page.pause();
  } else {
    console.log("Complete login + Gmail OTP in the browser window (waiting up to 5 min)...");
    await page.waitForURL((url) => !url.href.includes("/login"), { timeout: 300_000 });
    console.log("Login detected.");
  }

  await context.storageState({ path: AUTH_STATE_PATH });
  console.log(`Saved session to ${AUTH_STATE_PATH}`);

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
