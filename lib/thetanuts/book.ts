// Thetanuts Base book scanner.
//
// GROUND TRUTH (verified via previewFillOrder math against live orders):
// on the OptionBook the taker is ALWAYS the buyer - filling any order means
// paying premium for the option. Selling (underwriting) happens exclusively
// through the RFQ OptionFactory (see rfq.ts). Conventions:
// - order.price is 8-decimal USDC per 1.0 contract
// - previewFillOrder(order, usdcSpend 6dp) -> numContracts 6dp = spend/price,
//   capped at maxContracts = maker collateral budget / strike
import { getThetanutsClient } from "./client";

const WETH = "0x4200000000000000000000000000000000000006".toLowerCase();

export interface BuyableOffer {
  kind: "put" | "putSpread" | "call";
  dte: number;
  expiry: number;
  strikes: number[];
  /** USDC you pay per 1.0 contract (their ask) */
  premiumPerContract: number;
  /** max payout per contract: strike for puts (ETH->0), width for spreads */
  maxPayoutPerContract: number;
  assignProb: number | null; // |delta| where the API provides greeks
  iv: number | null;
  /** maker budget cap, in contracts */
  maxContracts: number;
  /** opaque signed order, needed to fill via SDK */
  raw: unknown;
}

export interface MonthlyIndication {
  dte: number;
  strike: number;
  mmAskPerContract: number;  // what buyers pay at this strike/tenor
  estSellerPremium: number;  // ask minus haircut - what an RFQ seller can target
  cycleYield: number;        // estSellerPremium / strike (seller view)
  apy: number;
  assignProb: number | null;
  iv: number | null;
}

export interface BookScan {
  spot: number;
  fetchedAt: number;
  /** instantly buyable protection: vanilla ETH puts, any tenor */
  protectionPuts: BuyableOffer[];
  /** instantly buyable defined-payout put spreads */
  protectionSpreads: BuyableOffer[];
  /** instantly buyable calls (upside participation) */
  buyableCalls: BuyableOffer[];
  /** seller-side reference pricing for the 30d RFQ path */
  monthlyIndications: MonthlyIndication[];
}

interface RawOrder {
  order: {
    price: string | number;
    expiry: string | number;
    strikes: (string | number)[];
    underlyingToken: string;
    maker: string;
  };
  availableAmount: string | number;
  rawApiData?: {
    isCall?: boolean;
    strikes?: (string | number)[];
    greeks?: { delta?: number; iv?: number };
    maxCollateralUsable?: string | number;
  };
}

export async function scanBook(haircut = 0.15): Promise<BookScan> {
  const c = await getThetanutsClient();
  const [md, ordersRaw] = await Promise.all([c.api.getMarketData(), c.api.fetchOrders()]);
  const spot: number = md.prices.ETH;
  const now = Math.floor(Date.now() / 1000);
  const orders = ordersRaw as unknown as RawOrder[];

  const eth = orders.filter((o) => o.order.underlyingToken?.toLowerCase() === WETH);

  const protectionPuts: BuyableOffer[] = [];
  const protectionSpreads: BuyableOffer[] = [];
  const buyableCalls: BuyableOffer[] = [];
  const monthlyIndications: MonthlyIndication[] = [];

  for (const o of eth) {
    const raw = o.rawApiData ?? {};
    const isCall = raw.isCall ?? false;
    const strikes = (raw.strikes ?? o.order.strikes ?? []).map((s) => Number(s) / 1e8);
    const expiry = Number(o.order.expiry);
    const dte = (expiry - now) / 86400;
    if (dte <= 0.1 || strikes.length > 2) continue;
    const premium = Number(o.order.price) / 1e8;
    if (premium <= 0) continue;
    const greeks = raw.greeks;
    const budgetUsdc = Number(o.availableAmount) / 1e6;

    const base = {
      dte,
      expiry,
      strikes,
      premiumPerContract: premium,
      assignProb: greeks?.delta != null ? Math.abs(greeks.delta) : null,
      iv: greeks?.iv ?? null,
      raw: o,
    };

    if (!isCall && strikes.length === 1) {
      const k = strikes[0];
      protectionPuts.push({
        ...base,
        kind: "put",
        maxPayoutPerContract: k,
        maxContracts: budgetUsdc / k,
      });
      if (dte >= 18 && dte <= 45) {
        const est = premium * (1 - haircut);
        const cyc = est / k;
        monthlyIndications.push({
          dte, strike: k, mmAskPerContract: premium, estSellerPremium: est,
          cycleYield: cyc, apy: cyc * (365 / dte),
          assignProb: base.assignProb, iv: base.iv,
        });
      }
    } else if (!isCall && strikes.length === 2) {
      const width = Math.abs(strikes[0] - strikes[1]);
      protectionSpreads.push({
        ...base,
        kind: "putSpread",
        maxPayoutPerContract: width,
        maxContracts: budgetUsdc / width,
      });
    } else if (isCall && strikes.length === 1) {
      buyableCalls.push({
        ...base,
        kind: "call",
        maxPayoutPerContract: Infinity,
        maxContracts: budgetUsdc / strikes[0],
      });
    }
  }

  protectionPuts.sort((a, b) => a.dte - b.dte || a.strikes[0] - b.strikes[0]);
  protectionSpreads.sort((a, b) => a.dte - b.dte);
  buyableCalls.sort((a, b) => a.dte - b.dte || a.strikes[0] - b.strikes[0]);
  monthlyIndications.sort((a, b) => a.dte - b.dte || a.strike - b.strike);

  return { spot, fetchedAt: now, protectionPuts, protectionSpreads, buyableCalls, monthlyIndications };
}
