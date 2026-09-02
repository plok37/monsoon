// Monsoon gate engine — decides whether the underwriting shelf is open and
// at what strike. Logic mirrors research/backtest.py (parity-tested).
import { bsPut, strikeForPutDelta } from "./math";

export interface GateParams {
  tenorDays: number;       // option tenor
  targetDelta: number;     // |delta| for the headline strike
  haircut: number;         // fraction of BS premium lost to MM spread
  gateDrawdown: number;    // require spot <= gateDrawdown * 30d high
  gateIvRank: number;      // require IV rank (365d) >= this
  capMa200: boolean;       // strike <= 200d MA
  premFloorPut: number;    // require net premium / strike >= this per cycle
  maxDeploy: number;       // max fraction of reserve underwriting at once
}

export const DEFAULT_PARAMS: GateParams = {
  tenorDays: 30,
  targetDelta: 0.2,
  haircut: 0.15,
  gateDrawdown: 0.9,
  gateIvRank: 0.3,
  capMa200: true,
  premFloorPut: 0.008,
  maxDeploy: 0.5,
};

/** Everything the engine needs to know about the market right now. */
export interface MarketSnapshot {
  spot: number;
  sigma: number;    // annualized vol (DVOL / 100)
  hi30: number;     // 30-day high of daily closes
  ma200: number;    // 200-day moving average
  ivRank: number;   // (DVOL - min365) / (max365 - min365)
  pctile25: number; // 25th percentile of trailing 365 daily closes
}

export interface GateCheck {
  id: "drawdown" | "ivRank" | "premFloor";
  label: string;
  pass: boolean;
  detail: string;
}

export interface GateDecision {
  open: boolean;
  checks: GateCheck[];
  /** Present when the strike/premium leg was evaluated (drawdown+IV passed). */
  quote?: {
    strike: number;
    premiumPerContract: number; // net of haircut, USDC per 1 ETH contract
    cycleYield: number;         // premium / strike
    apy: number;                // annualized
  };
}

export function evaluateGates(m: MarketSnapshot, p: GateParams = DEFAULT_PARAMS): GateDecision {
  const T = p.tenorDays / 365;
  const checks: GateCheck[] = [];

  const ddLimit = p.gateDrawdown * m.hi30;
  const ddPass = m.spot <= ddLimit;
  const offHigh = (1 - m.spot / m.hi30) * 100;
  checks.push({
    id: "drawdown",
    label: "Price has pulled back",
    pass: ddPass,
    detail: ddPass
      ? `ETH is ${offHigh.toFixed(1)}% below its 30-day high — insurance demand is real`
      : `ETH is only ${offHigh.toFixed(1)}% below its 30-day high (needs ≥ ${((1 - p.gateDrawdown) * 100).toFixed(0)}%) — we don't sell insurance cheap`,
  });

  const ivPass = m.ivRank >= p.gateIvRank;
  checks.push({
    id: "ivRank",
    label: "Insurance is expensive",
    pass: ivPass,
    detail: `Volatility rank ${(m.ivRank * 100).toFixed(0)}/100 over the last year (needs ≥ ${(p.gateIvRank * 100).toFixed(0)})`,
  });

  if (!ddPass || !ivPass) {
    return { open: false, checks };
  }

  let strike = strikeForPutDelta(m.spot, m.sigma, T, p.targetDelta);
  if (p.capMa200) strike = Math.min(strike, m.ma200);
  const premium = bsPut(m.spot, strike, m.sigma, T) * (1 - p.haircut);
  const cycleYield = premium / strike;
  const premPass = cycleYield >= p.premFloorPut;
  checks.push({
    id: "premFloor",
    label: "Premium worth the risk",
    pass: premPass,
    detail: premPass
      ? `${(cycleYield * 100).toFixed(2)}% per ${p.tenorDays}d cycle at the $${strike.toFixed(0)} strike`
      : `Only ${(cycleYield * 100).toFixed(2)}% per cycle at the historically-anchored $${strike.toFixed(0)} strike (needs ≥ ${(p.premFloorPut * 100).toFixed(1)}%)`,
  });

  return {
    open: premPass,
    checks,
    quote: {
      strike,
      premiumPerContract: premium,
      cycleYield,
      apy: cycleYield * (365 / p.tenorDays),
    },
  };
}
