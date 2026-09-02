import { chromium } from "playwright-core";
import { execSync } from "child_process";

const exe = execSync("ls ~/.cache/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-linux64/chrome-headless-shell").toString().trim();
const browser = await chromium.launch({ executablePath: exe });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const outDir = process.env.OUT ?? ".";
const shots = [
  ["http://localhost:3777/", "shelf-live"],
  ["http://localhost:3777/evidence", "evidence"],
  ["http://localhost:3777/copilot", "copilot"],
  ["http://localhost:3777/position", "position"],
];
for (const [url, name] of shots) {
  await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${outDir}/${name}.png`, fullPage: true });
  console.log(name, "ok");
}
// demo mode: click the replay button on the shelf
await page.goto("http://localhost:3777/", { waitUntil: "networkidle" });
await page.click("text=Replay June 2022");
await page.waitForTimeout(2500);
await page.screenshot({ path: `${outDir}/shelf-demo.png`, fullPage: true });
console.log("shelf-demo ok");
// light mode
await page.click('button[aria-label="Switch to light mode"]');
await page.waitForTimeout(600);
await page.screenshot({ path: `${outDir}/shelf-demo-light.png`, fullPage: true });
console.log("light ok");
await browser.close();
