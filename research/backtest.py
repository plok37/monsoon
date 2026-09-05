#!/usr/bin/env python3
"""
30-day ETH wheel backtest: HODL vs naive wheel vs gated wheel ("insurance underwriter").

Data: data/eth_daily.csv (Coinbase daily + Deribit DVOL close).
Options: Black-Scholes, r=0, sigma = DVOL/100 (flat smile), 30-day tenor,
premium haircut HAIRCUT (MM spread) on all premiums RECEIVED.
Settlement: physical. Puts cash-secured (lock K per contract), calls covered.
Idle USDC earns IDLE_APY. Equity marked daily incl. BS value of short options.
"""
import csv, math, datetime as dt
from pathlib import Path

DATA = Path(__file__).parent / "data" / "eth_daily.csv"
START = "2021-04-01"          # DVOL available from 2021-03-24
TENOR = 30                    # days
TARGET_DELTA = 0.20
HAIRCUT = 0.15                # fraction of BS premium lost to MM spread
IDLE_APY = 0.045
START_CASH = 100_000.0

# gated-wheel parameters
GATE_DRAWDOWN = 0.90          # spot <= 90% of 30d high
GATE_IVRANK = 0.30            # IV rank over trailing 365d
CAP_MA200 = True              # strike <= 200d MA
PREM_FLOOR_PUT = 0.008        # >=0.8% of collateral per 30d cycle
PREM_FLOOR_CALL = 0.002       # else just hold
MAX_DEPLOY = 0.50             # fraction of cash underwriting at once

def N(x): return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))

def inv_norm(p):
    # Acklam approximation
    a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02,
         1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00]
    b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02,
         6.680131188771972e+01, -1.328068155288572e+01]
    c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00,
         -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00]
    d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00,
         3.754408661907416e+00]
    plow, phigh = 0.02425, 1 - 0.02425
    if p < plow:
        q = math.sqrt(-2 * math.log(p))
        return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1)
    if p > phigh:
        q = math.sqrt(-2 * math.log(1 - p))
        return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1)
    q = p - 0.5; r = q * q
    return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q / (((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1)

def bs_put(S, K, sig, T):
    if T <= 0: return max(K - S, 0.0)
    st = sig * math.sqrt(T)
    d1 = (math.log(S / K) + 0.5 * sig * sig * T) / st
    return K * N(-(d1 - st)) - S * N(-d1)

def bs_call(S, K, sig, T):
    if T <= 0: return max(S - K, 0.0)
    st = sig * math.sqrt(T)
    d1 = (math.log(S / K) + 0.5 * sig * sig * T) / st
    return S * N(d1) - K * N(d1 - st)

def strike_for_put_delta(S, sig, T, delta):
    d1 = -inv_norm(delta)          # N(-d1)=delta
    return S * math.exp(-(d1 * sig * math.sqrt(T) - 0.5 * sig * sig * T))

def strike_for_call_delta(S, sig, T, delta):
    d1 = inv_norm(delta)           # N(d1)=delta
    return S * math.exp(-(d1 * sig * math.sqrt(T) - 0.5 * sig * sig * T))

# ---------- load data ----------
rows = []
with open(DATA) as f:
    for r in csv.DictReader(f):
        rows.append((r["date"], float(r["close"]), float(r["dvol"]) if r["dvol"] else None))
dates  = [r[0] for r in rows]
closes = [r[1] for r in rows]
dvols  = [r[2] for r in rows]
idx0 = dates.index(START)

def sigma(i):
    j = i
    while dvols[j] is None: j -= 1
    return dvols[j] / 100.0

def ma200(i):    return sum(closes[i-199:i+1]) / 200
def hi30(i):     return max(closes[i-29:i+1])
def pctile25(i):
    w = sorted(closes[i-364:i+1]); return w[int(0.25 * len(w))]
def iv_rank(i):
    w = [v for v in dvols[max(0,i-364):i+1] if v is not None]
    lo, hi = min(w), max(w)
    return 0.5 if hi == lo else (sigma(i)*100 - lo) / (hi - lo)

DAILY_IDLE = (1 + IDLE_APY) ** (1/365) - 1

class Wheel:
    """gated=False -> naive wheel (100% deploy, no gates, calls at delta even below basis)."""
    def __init__(self, gated):
        self.gated = gated
        self.cash = START_CASH; self.locked = 0.0
        self.eth = 0.0; self.basis = 0.0
        self.put = None; self.call = None      # (K, contracts, expiry_i)
        self.prem = 0.0; self.n_puts = 0; self.n_assign = 0; self.n_calls = 0
        self.n_skip = 0; self.n_cycles = 0; self.curve = []

    def equity(self, i):
        S, sig = closes[i], sigma(i)
        eq = self.cash + self.locked + self.eth * S
        if self.put:
            K, n, e = self.put;  eq -= n * bs_put(S, K, sig, max((e - i) / 365, 0))
        if self.call:
            K, n, e = self.call; eq -= n * bs_call(S, K, sig, max((e - i) / 365, 0))
        return eq

    def step(self, i):
        S, sig = closes[i], sigma(i)
        self.cash *= (1 + DAILY_IDLE) if self.gated else 1.0
        # settle expiries
        if self.put and i >= self.put[2]:
            K, n, _ = self.put; self.put = None
            if S < K:   # assigned: locked cash buys n ETH at K
                self.locked -= n * K; self.eth += n; self.basis = K; self.n_assign += 1
            else:
                self.cash += self.locked; self.locked = 0.0
        if self.call and i >= self.call[2]:
            K, n, _ = self.call; self.call = None
            if S > K:   # called away
                self.cash += n * K; self.eth -= n
                if self.eth < 1e-12: self.eth, self.basis = 0.0, 0.0
        # open new positions on cycle boundaries
        if (i - idx0) % TENOR != 0: return
        self.n_cycles += 1
        T = TENOR / 365
        # covered calls on any ETH held
        if self.eth > 1e-12 and not self.call:
            K = strike_for_call_delta(S, sig, T, TARGET_DELTA)
            if self.gated: K = max(K, self.basis)
            p = bs_call(S, K, sig, T) * (1 - HAIRCUT)
            if not self.gated or (S > 0 and p / S >= PREM_FLOOR_CALL):
                self.cash += p * self.eth; self.prem += p * self.eth
                self.call = (K, self.eth, i + TENOR); self.n_calls += 1
        # cash-secured puts
        if self.put or self.cash <= 0: return
        if self.gated:
            if S > GATE_DRAWDOWN * hi30(i) or iv_rank(i) < GATE_IVRANK:
                self.n_skip += 1; return
            K = strike_for_put_delta(S, sig, T, TARGET_DELTA)
            if CAP_MA200: K = min(K, ma200(i))
            p = bs_put(S, K, sig, T) * (1 - HAIRCUT)
            if p / K < PREM_FLOOR_PUT: self.n_skip += 1; return
            budget = self.cash * MAX_DEPLOY
        else:
            K = strike_for_put_delta(S, sig, T, TARGET_DELTA)
            p = bs_put(S, K, sig, T) * (1 - HAIRCUT)
            budget = self.cash
        n = budget / K
        self.cash -= budget; self.locked += budget
        self.cash += p * n; self.prem += p * n
        self.put = (K, n, i + TENOR); self.n_puts += 1

def drawdown(curve):
    peak, mdd = -1e18, 0.0
    for v in curve:
        peak = max(peak, v); mdd = max(mdd, (peak - v) / peak)
    return mdd

naive, gated = Wheel(False), Wheel(True)
hodl_eth = START_CASH / closes[idx0]
hodl_curve = []
for i in range(idx0, len(dates)):
    naive.step(i); gated.step(i)
    naive.curve.append(naive.equity(i)); gated.curve.append(gated.equity(i))
    hodl_curve.append(hodl_eth * closes[i])

years = (len(dates) - idx0) / 365
def report(name, curve, w=None):
    tot = curve[-1] / START_CASH - 1
    apy = (curve[-1] / START_CASH) ** (1 / years) - 1
    line = f"{name:<14} end=${curve[-1]:>10,.0f}  total={tot*100:>7.1f}%  APY={apy*100:>6.2f}%  maxDD={drawdown(curve)*100:>5.1f}%"
    if w: line += (f"  puts={w.n_puts}/{w.n_cycles}cyc skip={w.n_skip} assigned={w.n_assign}"
                   f" calls={w.n_calls} premium=${w.prem:,.0f}")
    print(line)

print(f"Backtest {dates[idx0]} .. {dates[-1]}  ({years:.2f}y)  ETH ${closes[idx0]:,.0f} -> ${closes[-1]:,.0f}")
print(f"tenor={TENOR}d delta={TARGET_DELTA} haircut={HAIRCUT:.0%} idle={IDLE_APY:.1%} "
      f"gates: dd<={1-GATE_DRAWDOWN:.0%}of30dHi ivrank>={GATE_IVRANK} ma200cap={CAP_MA200} "
      f"premFloor={PREM_FLOOR_PUT:.1%} deploy<={MAX_DEPLOY:.0%}\n")
report("HODL", hodl_curve)
report("Naive wheel", naive.curve, naive)
report("Gated wheel", gated.curve, gated)

# worst 12 months for each
def worst12(curve):
    worst = 1e9
    for i in range(365, len(curve)):
        worst = min(worst, curve[i] / curve[i-365] - 1)
    return worst
print(f"\nworst rolling 12m: HODL {worst12(hodl_curve)*100:.1f}%  "
      f"naive {worst12(naive.curve)*100:.1f}%  gated {worst12(gated.curve)*100:.1f}%")

# yearly table
print("\nyear-end equity:")
print(f"{'year':<6}{'HODL':>12}{'naive':>12}{'gated':>12}")
for y in range(2021, 2027):
    last = max((k for k, d in enumerate(dates[idx0:], 0) if d.startswith(str(y))), default=None)
    if last is not None:
        print(f"{y:<6}{hodl_curve[last]:>12,.0f}{naive.curve[last]:>12,.0f}{gated.curve[last]:>12,.0f}")

# ---------- machine-readable outputs ----------
import json
step = 7  # weekly points keep the JSON small; the final day is always included
sample = list(range(0, len(hodl_curve), step))
if sample[-1] != len(hodl_curve) - 1:
    sample.append(len(hodl_curve) - 1)
out = {
    "meta": {"start": dates[idx0], "end": dates[-1], "years": round(years, 2),
             "tenor": TENOR, "delta": TARGET_DELTA, "haircut": HAIRCUT, "idleApy": IDLE_APY,
             "gates": {"drawdown": GATE_DRAWDOWN, "ivRank": GATE_IVRANK, "ma200Cap": CAP_MA200,
                        "premFloorPut": PREM_FLOOR_PUT, "maxDeploy": MAX_DEPLOY}},
    "curves": {
        "dates": [dates[idx0 + k] for k in sample],
        "hodl":  [round(hodl_curve[k])  for k in sample],
        "naive": [round(naive.curve[k]) for k in sample],
        "gated": [round(gated.curve[k]) for k in sample],
        "eth":   [round(closes[idx0 + k], 2) for k in sample],
    },
    "summary": {
        "hodl":  {"end": round(hodl_curve[-1]),  "maxDD": round(drawdown(hodl_curve), 4)},
        "naive": {"end": round(naive.curve[-1]), "maxDD": round(drawdown(naive.curve), 4),
                   "puts": naive.n_puts, "assigned": naive.n_assign, "premium": round(naive.prem)},
        "gated": {"end": round(gated.curve[-1]), "maxDD": round(drawdown(gated.curve), 4),
                   "puts": gated.n_puts, "skipped": gated.n_skip, "assigned": gated.n_assign,
                   "premium": round(gated.prem)},
    },
}
with open(Path(__file__).parent / "backtest_output.json", "w") as f:
    json.dump(out, f)
print("\nwrote backtest_output.json")

# parity fixture: per-cycle gate decisions for the gated wheel
fixture = []
w = Wheel(True)
for i in range(idx0, len(dates)):
    pre_put = w.put is not None
    w.step(i)
    if (i - idx0) % TENOR == 0 and not pre_put:
        S, sig = closes[i], sigma(i)
        T = TENOR / 365
        Kd = strike_for_put_delta(S, sig, T, TARGET_DELTA)
        K = min(Kd, ma200(i)) if CAP_MA200 else Kd
        fixture.append({
            "date": dates[i], "spot": S, "sigma": round(sig, 6),
            "hi30": hi30(i), "ma200": round(ma200(i), 2), "ivRank": round(iv_rank(i), 6),
            "strike": round(K, 4),
            "premium": round(bs_put(S, K, sig, T) * (1 - HAIRCUT), 6),
            "sold": w.put is not None and w.put[2] == i + TENOR,
        })
with open(Path(__file__).parent / "parity_fixture.json", "w") as f:
    json.dump(fixture, f, indent=1)
print(f"wrote parity_fixture.json ({len(fixture)} cycle decisions)")
