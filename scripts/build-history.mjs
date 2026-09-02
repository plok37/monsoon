// Convert research/data/eth_daily.csv -> lib/data/history.json (bundled with the app).
// Run: node scripts/build-history.mjs
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const here = dirname(fileURLToPath(import.meta.url));
const csv = readFileSync(join(here, "..", "..", "research", "data", "eth_daily.csv"), "utf8");
const lines = csv.trim().split("\n").slice(1);
const dates = [], closes = [], dvol = [];
for (const l of lines) {
  const [d, , , , close, dv] = l.split(",");
  dates.push(d);
  closes.push(Number(close));
  dvol.push(dv ? Number(dv) : null);
}
const out = { dates, closes, dvol };
mkdirSync(join(here, "..", "lib", "data"), { recursive: true });
writeFileSync(join(here, "..", "lib", "data", "history.json"), JSON.stringify(out));
console.log(`history.json: ${dates.length} days, ${dates[0]} .. ${dates.at(-1)}`);
