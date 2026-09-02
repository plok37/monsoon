// Black-Scholes (r = 0) and inverse-normal helpers.
// Must stay numerically identical to research/backtest.py — parity-tested.

export function normCdf(x: number): number {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

// Numerical Recipes erfc approximation, fractional error < 1.2e-7 —
// well inside the parity tolerance vs Python's math.erf.
function erf(x: number): number {
  const z = Math.abs(x);
  const t = 1 / (1 + 0.5 * z);
  const ans =
    t *
    Math.exp(
      -z * z -
        1.26551223 +
        t * (1.00002368 + t * (0.37409196 + t * (0.09678418 +
        t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 +
        t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))),
    );
  return x >= 0 ? 1 - ans : ans - 1;
}

// Acklam's inverse normal CDF approximation (same as Python side).
export function invNorm(p: number): number {
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
    1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
    6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838,
    -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996,
    3.754408661907416];
  const plow = 0.02425;
  const phigh = 1 - plow;
  if (p < plow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > phigh) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  const q = p - 0.5;
  const r = q * q;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/** European put, r = 0. S spot, K strike, sig annual vol, T years. */
export function bsPut(S: number, K: number, sig: number, T: number): number {
  if (T <= 0) return Math.max(K - S, 0);
  const st = sig * Math.sqrt(T);
  const d1 = (Math.log(S / K) + 0.5 * sig * sig * T) / st;
  return K * normCdf(-(d1 - st)) - S * normCdf(-d1);
}

/** European call, r = 0. */
export function bsCall(S: number, K: number, sig: number, T: number): number {
  if (T <= 0) return Math.max(S - K, 0);
  const st = sig * Math.sqrt(T);
  const d1 = (Math.log(S / K) + 0.5 * sig * sig * T) / st;
  return S * normCdf(d1) - K * normCdf(d1 - st);
}

/** Strike such that the put's |delta| equals `delta` (N(-d1) = delta). */
export function strikeForPutDelta(S: number, sig: number, T: number, delta: number): number {
  const d1 = -invNorm(delta);
  return S * Math.exp(-(d1 * sig * Math.sqrt(T) - 0.5 * sig * sig * T));
}

/** Strike such that the call's delta equals `delta` (N(d1) = delta). */
export function strikeForCallDelta(S: number, sig: number, T: number, delta: number): number {
  const d1 = invNorm(delta);
  return S * Math.exp(-(d1 * sig * Math.sqrt(T) - 0.5 * sig * sig * T));
}

/** |put delta| at a given strike — shown to users as assignment probability. */
export function putAssignProb(S: number, K: number, sig: number, T: number): number {
  if (T <= 0) return S < K ? 1 : 0;
  const st = sig * Math.sqrt(T);
  const d1 = (Math.log(S / K) + 0.5 * sig * sig * T) / st;
  return normCdf(-d1);
}
