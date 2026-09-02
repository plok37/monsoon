# Monsoon

**Premiums arrive with the storm.** Monsoon is a disciplined ETH "insurance underwriting" app built on the [Thetanuts SDK](https://docs.thetanuts.finance/sdk) on Base mainnet, with an AI copilot whose reasoning runs on the [Gonka Router](https://gonkarouter.io).

Built for the MUBA Blockchain Hackathon 2026 by team **Formal Sweatpants**, targeting the *Best Product on the Thetanuts SDK* and *AI × Options* tracks.

## The idea

Selling cash-secured puts ("the wheel") is how retail can act like an insurance company: collect premium now, promise to buy ETH at a lower strike if things go bad. The catch, proven by our own backtest, is that selling premium **every cycle regardless of conditions loses money**: over Apr 2021 to Aug 2026, a naive wheel collected $159k of premium on a $100k account and still finished at $65k.

Monsoon only underwrites when three gates all pass:

1. **Price has pulled back** — ETH is at least 10% below its 30-day high. We sell insurance when there is a reason to buy it.
2. **Insurance is expensive** — implied-vol rank over the trailing year is elevated.
3. **Premium worth the risk** — at a strike capped by the 200-day average, the net premium clears a floor per 30-day cycle.

If any gate fails, the shelf is closed and the reserve simply earns lending yield, like an insurer's float. Same backtest, same costs: the gated wheel finished at **$138k (6.2% APY, 31.5% max drawdown)** vs buy-and-hold's $124k (79% drawdown), and was **up 9% in 2022** while ETH lost 65%. See the in-app **Evidence** page; reproduce it with `research/backtest.py` in the parent repo.

## What's inside

- **Shelf** (`/`) — live gate status from real market data (Coinbase candles + Deribit DVOL), live sellable put bids and defined-risk put spreads from the Thetanuts OptionBook, and 30-day RFQ premium indications. A "Replay June 2022" toggle shows the open shelf at the crash bottom.
- **Copilot** (`/copilot`) — chat that grounds every number in tool calls (`get_conditions`, `get_shelf`, `propose_trade`) and produces an executable trade ticket. All LLM reasoning goes through Gonka Router; request ids are shown under each answer.
- **Position** (`/position`) — your live Thetanuts positions and trade history from the indexer.
- **Evidence** (`/evidence`) — the 5.4-year backtest, honestly presented, assumptions included.

Execution is fully non-custodial: the server only reads; fills are signed by the user's wallet against Thetanuts' audited OptionBook contract.

## Run it

```bash
npm install
cp .env.example .env.local   # add your GONKA_API_KEY
npm run dev
```

- `npm test` — parity test proving the TypeScript gate engine matches the Python backtest reference (fixtures in `../research/`).
- `npm run history` — rebuild the bundled price/vol history from the research CSV.

## Architecture notes

- `lib/engine/` — the gate engine (Black-Scholes r=0, Acklam inverse normal). Identical math to the backtest; `scripts/parity.ts` enforces it.
- `lib/thetanuts/` — read-side book scanning (server) and wallet-side execution (client). OptionBook order prices are 8-decimal; USDC amounts 6-decimal.
- `lib/market-data.ts` — bundled daily series (2019 to the build date) extended live from Coinbase and Deribit at request time.
- `app/api/copilot` — Gonka Router tool loop (OpenAI-compatible `chat/completions`).

## Honest limitations

A backtest is evidence, not a guarantee; all our "policies" share one correlated risk (ETH), so drawdowns are bounded, not eliminated. Thirty-day put selling routes through Thetanuts RFQ, where realized premiums depend on market-maker bids. This is a hackathon prototype, not financial advice.
