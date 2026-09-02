// Thetanuts Base book scanner. Categorizes live orders into Monsoon shelf offers.
//
// Verified conventions (see research/pricing/analyze-book.mjs):
// - order.price is 8-decimal USDC per contract; availableAmount is 6-decimal USDC.
// - order.isBuyer === true  -> the MAKER (MM) is buying, so WE can SELL (write).
// - Vanilla put bids only exist short-dated (~1-3 DTE); monthly vanillas are MM
//   asks, which we use as indicative pricing for the 30d RFQ path.
import { getThetanutsClient } from "./client";

const WETH = "0x4200000000000000000000000000000000000006".toLowerCase();

export interface ShelfOffer {
  kind: "put" | "putSpread";
  source: "book";            // fillable right now on OptionBook
  dte: number;               // days to expiry
  expiry: number;            // unix seconds
  strikes: number[];         // [K] or [Kshort, Klong]
  premiumPerContract: number;// USDC received per 1 ETH contract
  collateralPerContract: number; // USDC locked per contract
  cycleYield: number;        // premium / collateral
  apy: number;
  assignProb: number | null; // |delta| when the API provides greeks
  iv: number | null;
  availableUsdc: number;     // maker budget remaining
  /** opaque original order, needed to fill via SDK */
  raw: unknown;
}

export interface MonthlyIndication {
  dte: number;
  strike: number;
  mmAskPerContract: number;  // what MMs charge buyers at this strike/tenor
  estSellerPremium: number;  // ask minus haircut — what an RFQ seller can expect
  cycleYield: number;
  apy: number;
  assignProb: number | null;
  iv: number | null;
}

export interface BookScan {
  spot: number;
  fetchedAt: number;
  sellablePuts: ShelfOffer[];
  sellablePutSpreads: ShelfOffer[];
  monthlyIndications: MonthlyIndication[];
}

interface RawOrder {
  order: {
    isBuyer: boolean;
    price: string | number;
    expiry: string | number;
    strikes: (string | number)[];
    underlyingToken: string;
  };
  availableAmount: string | number;
  rawApiData?: {
    isCall?: boolean;
    strikes?: (string | number)[];
    greeks?: { delta?: number; iv?: number };
  };
}

export async function scanBook(haircut = 0.15): Promise<BookScan> {
  const c = await getThetanutsClient();
  const [md, ordersRaw] = await Promise.all([c.api.getMarketData(), c.api.fetchOrders()]);
  const spot: number = md.prices.ETH;
  const now = Math.floor(Date.now() / 1000);
  const orders = ordersRaw as unknown as RawOrder[];

  const eth = orders.filter(
    (o) => o.order.underlyingToken?.toLowerCase() === WETH,
  );

  const sellablePuts: ShelfOffer[] = [];
  const sellablePutSpreads: ShelfOffer[] = [];
  const monthlyIndications: MonthlyIndication[] = [];

  for (const o of eth) {
    const raw = o.rawApiData ?? {};
    const isCall = raw.isCall ?? false;
    const strikes = (raw.strikes ?? o.order.strikes ?? []).map((s) => Number(s) / 1e8);
    const expiry = Number(o.order.expiry);
    const dte = (expiry - now) / 86400;
    if (dte <= 0.1) continue;
    const premium = Number(o.order.price) / 1e8;
    const greeks = raw.greeks;

    if (!isCall && o.order.isBuyer && strikes.length === 1) {
      const k = strikes[0];
      const cyc = premium / k;
      sellablePuts.push({
        kind: "put", source: "book", dte, expiry, strikes,
        premiumPerContract: premium, collateralPerContract: k,
        cycleYield: cyc, apy: cyc * (365 / dte),
        assignProb: greeks?.delta != null ? Math.abs(greeks.delta) : null,
        iv: greeks?.iv ?? null,
        availableUsdc: Number(o.availableAmount) / 1e6,
        raw: o,
      });
    } else if (!isCall && o.order.isBuyer && strikes.length === 2) {
      const width = Math.abs(strikes[0] - strikes[1]);
      const cyc = premium / width;
      sellablePutSpreads.push({
        kind: "putSpread", source: "book", dte, expiry, strikes,
        premiumPerContract: premium, collateralPerContract: width,
        cycleYield: cyc, apy: cyc * (365 / dte),
        assignProb: null, iv: null,
        availableUsdc: Number(o.availableAmount) / 1e6,
        raw: o,
      });
    } else if (!isCall && !o.order.isBuyer && strikes.length === 1 && dte >= 18 && dte <= 45) {
      const k = strikes[0];
      const est = premium * (1 - haircut);
      const cyc = est / k;
      monthlyIndications.push({
        dte, strike: k, mmAskPerContract: premium, estSellerPremium: est,
        cycleYield: cyc, apy: cyc * (365 / dte),
        assignProb: greeks?.delta != null ? Math.abs(greeks.delta) : null,
        iv: greeks?.iv ?? null,
      });
    }
  }

  sellablePuts.sort((a, b) => a.dte - b.dte || a.strikes[0] - b.strikes[0]);
  sellablePutSpreads.sort((a, b) => a.dte - b.dte);
  monthlyIndications.sort((a, b) => a.strike - b.strike);

  return { spot, fetchedAt: now, sellablePuts, sellablePutSpreads, monthlyIndications };
}
