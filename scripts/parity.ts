// Parity test: the TS gate engine must reproduce the Python backtest's
// per-cycle decisions in research/parity_fixture.json.
// Run: npx tsx scripts/parity.ts
import { readFileSync } from "fs";
import { join } from "path";
import { evaluateGates, DEFAULT_PARAMS, type MarketSnapshot } from "../lib/engine/gates";

interface FixtureRow {
  date: string; spot: number; sigma: number; hi30: number; ma200: number;
  ivRank: number; strike: number; premium: number; sold: boolean;
}

const fixturePath = join(__dirname, "..", "..", "research", "parity_fixture.json");
const rows: FixtureRow[] = JSON.parse(readFileSync(fixturePath, "utf8"));

let failures = 0;
let strikeErrMax = 0;
let premErrMax = 0;

for (const r of rows) {
  const snap: MarketSnapshot = {
    spot: r.spot, sigma: r.sigma, hi30: r.hi30, ma200: r.ma200,
    ivRank: r.ivRank, pctile25: 0,
  };
  const d = evaluateGates(snap, DEFAULT_PARAMS);
  if (d.open !== r.sold) {
    failures++;
    console.error(`DECISION MISMATCH ${r.date}: python sold=${r.sold} ts open=${d.open}`);
    continue;
  }
  if (d.quote) {
    const se = Math.abs(d.quote.strike - r.strike) / r.strike;
    const pe = r.premium > 1e-9 ? Math.abs(d.quote.premiumPerContract - r.premium) / r.premium : 0;
    strikeErrMax = Math.max(strikeErrMax, se);
    premErrMax = Math.max(premErrMax, pe);
    if (se > 1e-4 || pe > 1e-3) {
      failures++;
      console.error(`VALUE MISMATCH ${r.date}: strike ${d.quote.strike} vs ${r.strike}, premium ${d.quote.premiumPerContract} vs ${r.premium}`);
    }
  }
}

console.log(`parity: ${rows.length} cycles, ${rows.filter(r => r.sold).length} sold, failures=${failures}`);
console.log(`max rel err — strike: ${strikeErrMax.toExponential(2)}, premium: ${premErrMax.toExponential(2)}`);
if (failures > 0) process.exit(1);
console.log("PARITY OK");
