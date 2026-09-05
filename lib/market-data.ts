// Market history: bundled daily series (Coinbase + Deribit DVOL through the
// research snapshot) extended live from both public APIs, with in-memory cache.
import history from "./data/history.json";
import type { MarketSnapshot } from "./engine/gates";

interface Series {
  dates: string[];
  closes: number[];
  dvol: (number | null)[];
}

const bundled = history as Series;

let cached: { series: Series; at: number } | null = null;
const TTL_MS = 10 * 60 * 1000;

async function fetchRecentCandles(sinceISO: string): Promise<Map<string, number>> {
  const start = new Date(sinceISO + "T00:00:00Z");
  const end = new Date();
  const url =
    `https://api.exchange.coinbase.com/products/ETH-USD/candles?granularity=86400` +
    `&start=${start.toISOString()}&end=${end.toISOString()}`;
  const res = await fetch(url, { headers: { "User-Agent": "monsoon/1.0" } });
  if (!res.ok) throw new Error(`coinbase ${res.status}`);
  const rows: number[][] = await res.json();
  const out = new Map<string, number>();
  for (const [ts, , , , close] of rows) {
    out.set(new Date(ts * 1000).toISOString().slice(0, 10), close);
  }
  return out;
}

async function fetchRecentDvol(sinceISO: string): Promise<Map<string, number>> {
  const start = new Date(sinceISO + "T00:00:00Z").getTime();
  const url =
    `https://www.deribit.com/api/v2/public/get_volatility_index_data` +
    `?currency=ETH&start_timestamp=${start}&end_timestamp=${Date.now()}&resolution=86400`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`deribit ${res.status}`);
  const json = await res.json();
  const out = new Map<string, number>();
  for (const [ts, , , , close] of json.result.data as number[][]) {
    out.set(new Date(ts).toISOString().slice(0, 10), close);
  }
  return out;
}

let liveDvolCache: { value: number; at: number } | null = null;

/** Latest minute-resolution DVOL tick (cached 5 min). Null on API failure. */
export async function getLiveDvol(): Promise<number | null> {
  if (liveDvolCache && Date.now() - liveDvolCache.at < 5 * 60 * 1000) return liveDvolCache.value;
  try {
    const now = Date.now();
    const url =
      `https://www.deribit.com/api/v2/public/get_volatility_index_data` +
      `?currency=ETH&start_timestamp=${now - 2 * 3600_000}&end_timestamp=${now}&resolution=60`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data: number[][] = (await res.json()).result.data;
    if (!data?.length) return null;
    const value = data[data.length - 1][4] ?? data[data.length - 1][1];
    liveDvolCache = { value, at: Date.now() };
    return value;
  } catch {
    return null;
  }
}

/** Bundled series extended with any days since the snapshot. Falls back to bundled data on API failure. */
export async function getSeries(): Promise<Series> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.series;
  const series: Series = {
    dates: [...bundled.dates],
    closes: [...bundled.closes],
    dvol: [...bundled.dvol],
  };
  try {
    const lastDate = series.dates[series.dates.length - 1];
    const [candles, dvols] = await Promise.all([
      fetchRecentCandles(lastDate),
      fetchRecentDvol(lastDate),
    ]);
    const today = new Date().toISOString().slice(0, 10);
    for (let d = nextDay(lastDate); d <= today; d = nextDay(d)) {
      const close = candles.get(d);
      if (close === undefined) continue;
      series.dates.push(d);
      series.closes.push(close);
      series.dvol.push(dvols.get(d) ?? null);
    }
  } catch (e) {
    console.error("market-data live extension failed, using bundled series:", e);
  }
  cached = { series, at: Date.now() };
  return series;
}

function nextDay(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Gate-engine inputs as of index i in the series (defaults to the latest day). */
export function snapshotAt(series: Series, i?: number, spotOverride?: number, sigmaOverride?: number): MarketSnapshot {
  const idx = i ?? series.dates.length - 1;
  if (idx < 564) throw new Error("need >=565 days of history before this date");
  const closes = series.closes;

  let sigma = sigmaOverride;
  if (sigma === undefined) {
    for (let j = idx; j >= 0; j--) {
      const v = series.dvol[j];
      if (v != null) { sigma = v / 100; break; }
    }
    if (sigma === undefined) throw new Error("no DVOL data");
  }

  const win365 = closes.slice(idx - 364, idx + 1);
  const dvol365 = series.dvol.slice(Math.max(0, idx - 364), idx + 1).filter((v): v is number => v != null);
  const lo = Math.min(...dvol365);
  const hi = Math.max(...dvol365);
  const sorted = [...win365].sort((a, b) => a - b);

  return {
    spot: spotOverride ?? closes[idx],
    sigma,
    hi30: Math.max(...closes.slice(idx - 29, idx + 1), ...(spotOverride ? [spotOverride] : [])),
    ma200: closes.slice(idx - 199, idx + 1).reduce((a, b) => a + b, 0) / 200,
    ivRank: hi === lo ? 0.5 : (sigma * 100 - lo) / (hi - lo),
    pctile25: sorted[Math.floor(0.25 * sorted.length)],
  };
}

/** Index of an ISO date in the series (for demo mode), or -1. */
export function indexOfDate(series: Series, iso: string): number {
  return series.dates.indexOf(iso);
}
