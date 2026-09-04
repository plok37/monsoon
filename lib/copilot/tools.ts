// Copilot tool implementations.
//
// Market structure (verified on-chain): OptionBook fills are ALWAYS buys -
// the taker pays premium. Selling/underwriting happens only through the RFQ
// auction (the shelf's auction panel for puts; the Position page for covered
// calls). The copilot can therefore EXECUTE protection purchases, and can
// EXPLAIN/point to the auction for underwriting.
import { evaluateGates, DEFAULT_PARAMS } from "@/lib/engine/gates";
import { getSeries, snapshotAt } from "@/lib/market-data";
import { scanBook, type BookScan, type BuyableOffer } from "@/lib/thetanuts/book";
import type { ToolDef } from "@/lib/gonka";

export const TOOL_DEFS: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "get_conditions",
      description:
        "Current ETH market conditions and Monsoon's three underwriting gates (pass/fail with reasons).",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "get_shelf",
      description:
        "Live Thetanuts market. BUYABLE now (you pay premium): protective puts P1.., put spreads PS1.., calls C1... SELLER reference for the 30-day underwriting auction: M1.. rows (not directly fillable; underwriting happens via the RFQ auction on the shelf page). Premiums in USDC per 1 ETH contract.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_trade",
      description:
        "Build a BUY ticket for a fillable offer (id P.., PS.. or C.. from get_shelf) so the user can execute it with their wallet. usdcSpend is the premium the user pays (fractional contracts; $5-$50 is fine). Max loss = the premium paid. Only call after the user clearly chose an offer and amount.",
      parameters: {
        type: "object",
        properties: {
          offerId: { type: "string", description: "e.g. P2, PS1 or C3" },
          usdcSpend: { type: "number", description: "USDC premium to spend, e.g. 10" },
        },
        required: ["offerId", "usdcSpend"],
      },
    },
  },
];

// module-level cache so offer ids stay stable between get_shelf and propose_trade
let lastScan: { scan: BookScan; at: number } | null = null;
async function getScan(): Promise<BookScan> {
  if (lastScan && Date.now() - lastScan.at < 120_000) return lastScan.scan;
  const scan = await scanBook(DEFAULT_PARAMS.haircut);
  lastScan = { scan, at: Date.now() };
  return scan;
}

export interface TradeTicket {
  side: "buy";
  offerId: string;
  kind: "put" | "putSpread" | "call";
  strikes: number[];
  expiry: number;
  dte: number;
  premiumPerContract: number;
  usdcSpend: number;
  contracts: number;
  maxLoss: number;            // = premium paid
  maxPayout: number | null;   // null = uncapped (calls)
  breakeven: number;
  matchKey: { maker: string; kind: "put" | "putSpread" | "call"; strikes: number[]; expiry: number };
}

function offerLine(id: string, o: BuyableOffer, spot: number): string {
  const strikes = o.strikes.map((s) => `$${s}`).join("/");
  const name = o.kind === "put" ? "protective put" : o.kind === "putSpread" ? "put spread" : "call";
  const payout =
    o.kind === "call"
      ? "uncapped upside"
      : `pays (strike minus ETH settlement price)/contract, capped $${o.maxPayoutPerContract.toFixed(0)}`;
  const moneyness =
    o.kind === "call"
      ? spot >= o.strikes[0] ? "IN the money" : "out of the money"
      : spot <= o.strikes[0] ? "IN the money" : "out of the money";
  return `${id}: ${name} ${strikes}, ${o.dte.toFixed(1)}d, cost $${o.premiumPerContract.toFixed(2)}/contract, ${payout}, ${moneyness}${o.assignProb != null ? `, payout odds ~${(o.assignProb * 100).toFixed(0)}%` : ""}`;
}

export async function runTool(
  name: string,
  args: Record<string, unknown>,
): Promise<{ result: string; ticket?: TradeTicket }> {
  if (name === "get_conditions") {
    const [series, scan] = await Promise.all([getSeries(), getScan()]);
    const snap = snapshotAt(series, undefined, scan.spot);
    const d = evaluateGates(snap, DEFAULT_PARAMS);
    return {
      result: JSON.stringify({
        ethSpot: scan.spot,
        impliedVol: snap.sigma,
        high30d: snap.hi30,
        ma200: Math.round(snap.ma200),
        ivRank: +snap.ivRank.toFixed(2),
        underwritingShelfOpen: d.open,
        gates: d.checks.map((c) => ({ gate: c.label, pass: c.pass, detail: c.detail })),
      }),
    };
  }

  if (name === "get_shelf") {
    const scan = await getScan();
    const lines: string[] = [];
    scan.protectionPuts.forEach((o, i) => lines.push(offerLine(`P${i + 1}`, o, scan.spot)));
    scan.protectionSpreads.forEach((o, i) => lines.push(offerLine(`PS${i + 1}`, o, scan.spot)));
    scan.buyableCalls.forEach((o, i) => lines.push(offerLine(`C${i + 1}`, o, scan.spot)));
    scan.monthlyIndications.forEach((m, i) =>
      lines.push(
        `M${i + 1} (underwriting reference, NOT fillable - selling goes through the RFQ auction on the shelf page): put $${m.strike}, ${m.dte.toFixed(1)}d, buyers pay $${m.mmAskPerContract.toFixed(2)}/contract, an auction seller can target ~$${m.estSellerPremium.toFixed(2)}/contract (${(m.apy * 100).toFixed(1)}% APY on locked strike)`,
      ),
    );
    return {
      result: lines.length
        ? `ETH spot $${scan.spot}. Offer ids are Monsoon's labels for this list. BUYING (P/PS/C): you pay the premium now; that premium is your max loss. Fills are FRACTIONAL: spending X USDC buys X/cost contracts (even $5 works).\n${lines.join("\n")}`
        : "No live offers right now.",
    };
  }

  if (name === "propose_trade") {
    const offerId = String(args.offerId ?? "").toUpperCase().trim();
    const usdc = Number(args.usdcSpend);
    if (!offerId || !Number.isFinite(usdc) || usdc <= 0) {
      return { result: "ERROR: offerId and positive usdcSpend required" };
    }
    const scan = await getScan();
    const m = offerId.match(/^(P|PS|C)(\d+)$/);
    if (!m) {
      return {
        result: `ERROR: ${offerId} is not fillable. Only P.., PS.. and C.. can be bought here; M.. rows are references for the underwriting auction on the shelf page.`,
      };
    }
    const list =
      m[1] === "P" ? scan.protectionPuts : m[1] === "PS" ? scan.protectionSpreads : scan.buyableCalls;
    const offer = list[Number(m[2]) - 1];
    if (!offer) return { result: `ERROR: offer ${offerId} not found; call get_shelf again.` };
    const contracts = usdc / offer.premiumPerContract;
    if (contracts > offer.maxContracts) {
      return {
        result: `ERROR: maker budget caps this offer at ${offer.maxContracts.toFixed(4)} contracts (~$${(offer.maxContracts * offer.premiumPerContract).toFixed(2)})`,
      };
    }
    const raw = offer.raw as { order: { maker: string } };
    const k = offer.strikes[0];
    const ticket: TradeTicket = {
      side: "buy",
      offerId,
      kind: offer.kind,
      strikes: offer.strikes,
      expiry: offer.expiry,
      dte: offer.dte,
      premiumPerContract: offer.premiumPerContract,
      usdcSpend: usdc,
      contracts,
      maxLoss: usdc,
      maxPayout:
        offer.kind === "call" ? null : contracts * offer.maxPayoutPerContract,
      breakeven: offer.kind === "call" ? k + offer.premiumPerContract : k - offer.premiumPerContract,
      matchKey: {
        maker: raw.order.maker,
        kind: offer.kind,
        strikes: offer.strikes,
        expiry: offer.expiry,
      },
    };
    return {
      result: JSON.stringify({
        ok: true,
        note: "BUY ticket created and shown to the user with an Execute button. Summarize: premium paid (= max loss), what it pays out and when, breakeven.",
        ticket: { ...ticket, matchKey: undefined },
      }),
      ticket,
    };
  }

  return { result: `ERROR: unknown tool ${name}` };
}

/** Find the current signed order for a ticket by economic identity. */
export async function findRawOrder(matchKey: TradeTicket["matchKey"]) {
  const scan = await scanBook(DEFAULT_PARAMS.haircut);
  const list =
    matchKey.kind === "put"
      ? scan.protectionPuts
      : matchKey.kind === "putSpread"
        ? scan.protectionSpreads
        : scan.buyableCalls;
  const hit = list.find((o) => {
    const r = o.raw as { order: { maker: string } };
    return (
      r.order.maker.toLowerCase() === matchKey.maker.toLowerCase() &&
      o.expiry === matchKey.expiry &&
      o.strikes.length === matchKey.strikes.length &&
      o.strikes.every((s, i) => Math.abs(s - matchKey.strikes[i]) < 1e-6)
    );
  });
  if (!hit) return null;
  return { order: hit.raw, premiumPerContract: hit.premiumPerContract };
}
