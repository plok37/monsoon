#!/usr/bin/env python3
"""Fetch ETH-USD daily closes (Coinbase) and ETH DVOL (Deribit) -> CSV."""
import json, time, urllib.request, datetime as dt, csv, sys

UA = {"User-Agent": "muba-research/1.0"}

def get(url):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)

def fetch_eth_daily(start="2019-01-01"):
    out = {}
    t0 = dt.datetime.fromisoformat(start).replace(tzinfo=dt.timezone.utc)
    end = dt.datetime.now(dt.timezone.utc)
    cur = t0
    while cur < end:
        nxt = min(cur + dt.timedelta(days=290), end)
        url = (f"https://api.exchange.coinbase.com/products/ETH-USD/candles"
               f"?granularity=86400&start={cur:%Y-%m-%dT%H:%M:%SZ}&end={nxt:%Y-%m-%dT%H:%M:%SZ}")
        for row in get(url):  # [ time, low, high, open, close, volume ]
            d = dt.datetime.fromtimestamp(row[0], dt.timezone.utc).date().isoformat()
            out[d] = {"low": row[1], "high": row[2], "open": row[3], "close": row[4]}
        cur = nxt
        time.sleep(0.4)
    return dict(sorted(out.items()))

def fetch_dvol(start_ms=1616544000000):
    out = {}
    end_ms = int(time.time() * 1000)
    cur = start_ms
    while cur < end_ms:
        stop = min(cur + 900 * 86400_000, end_ms)
        url = (f"https://www.deribit.com/api/v2/public/get_volatility_index_data"
               f"?currency=ETH&start_timestamp={cur}&end_timestamp={stop}&resolution=86400")
        data = get(url)["result"]["data"]
        for ts, o, h, l, c in data:
            d = dt.datetime.fromtimestamp(ts / 1000, dt.timezone.utc).date().isoformat()
            out[d] = c
        cur = stop
        time.sleep(0.3)
    return dict(sorted(out.items()))

if __name__ == "__main__":
    px = fetch_eth_daily()
    print(f"ETH daily rows: {len(px)}  ({min(px)} .. {max(px)})", file=sys.stderr)
    dv = fetch_dvol()
    print(f"DVOL rows: {len(dv)}  ({min(dv)} .. {max(dv)})", file=sys.stderr)
    with open("eth_daily.csv", "w", newline="") as f:
        w = csv.writer(f); w.writerow(["date", "open", "high", "low", "close", "dvol"])
        for d, r in px.items():
            w.writerow([d, r["open"], r["high"], r["low"], r["close"], dv.get(d, "")])
    print("wrote eth_daily.csv", file=sys.stderr)
