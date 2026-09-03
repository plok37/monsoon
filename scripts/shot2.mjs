// Gallery screenshots: fresh shelf states + a real copilot conversation.
import { chromium } from "playwright-core";
import { execSync } from "child_process";

const exe = execSync(
  "ls ~/.cache/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-linux64/chrome-headless-shell",
).toString().trim();
const browser = await chromium.launch({ executablePath: exe });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const outDir = process.env.OUT ?? ".";

// 1. live shelf (calm)
await page.goto("http://localhost:3777/", { waitUntil: "networkidle", timeout: 60000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: `${outDir}/g-shelf-live.png` });
console.log("shelf live ok");

// 2. demo storm
await page.click("text=Replay June 2022");
await page.waitForTimeout(2500);
await page.screenshot({ path: `${outDir}/g-shelf-storm.png` });
console.log("storm ok");

// 3. evidence (scrolled to the chart)
await page.goto("http://localhost:3777/evidence", { waitUntil: "networkidle" });
await page.waitForTimeout(1200);
await page.screenshot({ path: `${outDir}/g-evidence.png`, fullPage: true });
console.log("evidence ok");

// 4. copilot with a real Gonka conversation
await page.goto("http://localhost:3777/copilot", { waitUntil: "networkidle" });
await page.fill("#copilot-input", "Why is the shelf closed right now?");
await page.click('button[aria-label="Send"]');
await page.waitForSelector("text=Gonka request", { timeout: 120000 });
await page.waitForTimeout(800);
await page.screenshot({ path: `${outDir}/g-copilot.png`, fullPage: true });
console.log("copilot ok");

await browser.close();
