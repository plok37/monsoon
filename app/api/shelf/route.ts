// GET /api/shelf            -> live gates + live offers
// GET /api/shelf?demo=2022-06-18 -> historical gate state with simulated offers
import { NextRequest, NextResponse } from "next/server";
import { evaluateGates, DEFAULT_PARAMS } from "@/lib/engine/gates";
import { bsPut, putAssignProb, strikeForPutDelta } from "@/lib/engine/math";
import { getSeries, indexOfDate, snapshotAt } from "@/lib/market-data";
import { scanBook } from "@/lib/thetanuts/book";

export const revalidate = 0;

export async function GET(req: NextRequest) {
  const demo = req.nextUrl.searchParams.get("demo");
  const series = await getSeries();

  if (demo) {
    const i = indexOfDate(series, demo);
    if (i < 564) {
      return NextResponse.json({ error: `no data for ${demo}` }, { status: 400 });
    }
    const snapshot = snapshotAt(series, i);
    const decision = evaluateGates(snapshot, DEFAULT_PARAMS);
    // Simulated 30d offers around the gate strike (no live book in the past).
    const T = DEFAULT_PARAMS.tenorDays / 365;
    const offers = [0.15, 0.2, 0.25].map((delta) => {
      let strike = strikeForPutDelta(snapshot.spot, snapshot.sigma, T, delta);
      if (DEFAULT_PARAMS.capMa200) strike = Math.min(strike, snapshot.ma200);
      strike = Math.round(strike / 10) * 10;
      const premium = bsPut(snapshot.spot, strike, snapshot.sigma, T) * (1 - DEFAULT_PARAMS.haircut);
      const cyc = premium / strike;
      return {
        kind: "put", source: "simulated", dte: DEFAULT_PARAMS.tenorDays,
        strikes: [strike], premiumPerContract: premium, collateralPerContract: strike,
        cycleYield: cyc, apy: cyc * (365 / DEFAULT_PARAMS.tenorDays),
        assignProb: putAssignProb(snapshot.spot, strike, snapshot.sigma, T),
        iv: snapshot.sigma,
      };
    });
    return NextResponse.json({ mode: "demo", date: demo, snapshot, decision, offers });
  }

  const [book] = await Promise.all([scanBook(DEFAULT_PARAMS.haircut)]);
  const snapshot = snapshotAt(series, undefined, book.spot);
  let decision = evaluateGates(snapshot, DEFAULT_PARAMS);

  // ?force=open renders the open-shelf layout with LIVE data for testing and
  // screenshots. The gate checks stay truthful; only the final decision is
  // overridden, and the response is flagged so the UI shows a preview badge.
  const forced = req.nextUrl.searchParams.get("force") === "open" && !decision.open;
  if (forced) decision = { ...decision, open: true };

  return NextResponse.json({
    mode: "live",
    forced,
    snapshot,
    decision,
    spot: book.spot,
    fetchedAt: book.fetchedAt,
    offers: {
      protectionPuts: book.protectionPuts.map(toView),
      protectionSpreads: book.protectionSpreads.map(toView),
      calls: book.buyableCalls.map(toView),
      monthlyRfq: book.monthlyIndications,
    },
  });
}

// Buyable offers: "yield" fields are meaningless to a premium payer; carry the
// cost and the max payout instead (collateralPerContract doubles as payout cap).
function toView(o: {
  kind: string; dte: number; expiry: number; strikes: number[];
  premiumPerContract: number; maxPayoutPerContract: number;
  assignProb: number | null; iv: number | null; maxContracts: number;
}) {
  return {
    kind: o.kind,
    source: "book" as const,
    dte: o.dte,
    expiry: o.expiry,
    strikes: o.strikes,
    premiumPerContract: o.premiumPerContract,
    collateralPerContract: o.maxPayoutPerContract,
    cycleYield: 0,
    apy: 0,
    assignProb: o.assignProb,
    iv: o.iv,
    maxContracts: o.maxContracts,
  };
}
