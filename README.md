# Monsoon

**Sell ETH insurance only when the storm pays for it.**

A two-sided, non-custodial ETH options market on [Thetanuts Finance](https://thetanuts.finance) (Base mainnet), with an AI copilot whose every answer is independently fact-checked. Built for the MUBA Blockchain Hackathon 2026.

**Live**: https://monsoon-zeta.vercel.app

## What it does

Selling cash-secured puts ("the wheel") is how ordinary people can act like an insurance company: get paid a premium now for promising to buy ETH cheaper. Every existing option vault sells that insurance **every week, at any price**. We backtested that on 5.4 years of real ETH data: the naive wheel collected $159k of premium on a $100k account and still finished at **$65k** (71% max drawdown). Premium is not income.

Monsoon has two sides:

- **Underwrite (sell insurance)** — only when three gates pass: ETH is 10%+ below its 30-day high, implied-vol rank is elevated, and the premium clears a floor at a historically-anchored strike. Selling happens through Thetanuts' sealed-bid **RFQ auctions**, creating **physically-settled** options: assignment delivers real ETH, and the Position page runs the wheel's second leg — a covered-call auction with a cost-basis guard. While the gates are closed, idle USDC earns Aave yield from the user's own wallet (the insurer's "float").
- **Protect (buy insurance)** — every OptionBook offer is instantly buyable: protective puts, defined-payout spreads, calls. The copilot builds the ticket (premium = max loss, breakeven, payout odds); your wallet signs.

Backtest (Apr 2021 – Aug 2026, $100k, same pricing and costs): gated wheel **$138k, 31.5% max DD, up 9% in 2022** vs buy-and-hold $124k (79% DD) vs naive wheel $65k (71% DD). See `/evidence` in the app.

## The AI copilot (Gonka)

All reasoning runs on the [Gonka Router](https://gonkarouter.io) decentralized network (MiniMax-M2.7), request IDs shown in the UI. Every answer is re-checked by an **independent second Gonka inference** that scores its faithfulness to the live tool data (0–100); below 80, a self-correction loop rewrites the answer before the user sees it. The model can never state a number that didn't come from an on-chain tool call, and it states max loss before any upside.

## Architecture

```
app/
  api/shelf      gates + live Thetanuts order book (protection + RFQ reference)
  api/copilot    Gonka tool loop (get_conditions / get_shelf / propose_trade)
                 + verification pass + self-correction
  api/rfq        sealed-bid auction status (phases, bids, best premium)
  api/order      fresh signed order by economic identity (MMs re-sign every ~60s)
  api/reserve    live Aave v3 Base USDC supply APY
lib/
  engine/        the gate engine - same code the backtest validates (npm test)
  thetanuts/     book scanner, buy execution, RFQ seller flows (puts + covered calls)
  market-data.ts Coinbase daily candles + Deribit DVOL, bundled + live-extended
research/
  backtest.py    the 5.4-year reference backtest (python3 research/backtest.py)
  parity_fixture.json  48 historical gate decisions the TS engine must reproduce
```

Non-custodial throughout: the server holds no keys; every transaction is signed by the user's wallet. Collateral for RFQ auctions moves only at settlement.

## Run it

```bash
npm install
cp .env.example .env.local   # add your GONKA_API_KEY
npm run dev
npm test                     # gate-engine parity vs the Python backtest
```

Requires a Base-mainnet wallet (MetaMask/Rabby) with a little USDC to trade. `/?force=open` previews the open-shelf layout on live data (visibly badged as an override).

## Hard-won facts (see also the Devfolio "challenges")

- **OptionBook takers are always buyers** — every fill pays premium, regardless of the order's `isBuyer` flag. We verified this with `previewFillOrder` arithmetic against live orders after building the wrong direction first. Selling happens only via RFQ.
- MMs re-sign orders with a new nonce every ~60s; match orders by maker + type + strikes + expiry.
- Physical RFQ options must expire Fridays 08:00 UTC (per the SDK contract docs).
- RFQ amounts are totals in the collateral token's decimals (USDC puts 6dp, WETH calls 18dp).
- Never annualize a sub-7-day option.

## Team

Formal Sweatpants — MUBA Blockchain Hackathon 2026. Prototype software; options carry risk of loss; not financial advice.
