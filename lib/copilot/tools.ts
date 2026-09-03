// Copilot tool implementations: everything the model may look at or propose.
import { evaluateGates, DEFAULT_PARAMS } from "@/lib/engine/gates";
import { getSeries, snapshotAt } from "@/lib/market-data";
import { scanBook, type BookScan, type ShelfOffer } from "@/lib/thetanuts/book";
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
        "Live offers: fillable short-dated put bids and put spreads on the Thetanuts OptionBook (ids D1.., S1..), plus 30-day RFQ indications (ids M1..). Premiums in USDC per 1 ETH contract.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_trade",
      description:
        "Build a trade ticket for a fillable offer (id D1.. or S1.. from get_shelf) so the user can execute it with their wallet. usdcCollateral is how much USDC of collateral the user commits (fractional contracts are fine, e.g. 15 USDC). Only call this after the user has chosen an offer.",
      parameters: {
        type: "object",
        properties: {
          offerId: { type: "string", description: "e.g. D2 or S1" },
          usdcCollateral: { type: "number", description: "USDC collateral to commit, e.g. 15" },
        },
        required: ["offerId", "usdcCollateral"],
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
  offerId: string;
  kind: "put" | "putSpread";
  strikes: number[];
  expiry: number;
  dte: number;
  premiumPerContract: number;
  collateralPerContract: number;
  usdcCollateral: number;
  contracts: number;
  premiumReceived: number;
  maxLoss: number | null; // null = you own ETH at strike (cash-secured put)
  matchKey: { maker: string; nonce: string };
}

function offerLine(id: string, o: ShelfOffer): string {
  const strikes = o.strikes.map((s) => `$${s}`).join("/");
  return `${id}: ${o.kind === "put" ? "put" : "put spread"} ${strikes}, ${o.dte.toFixed(1)}d, premium $${o.premiumPerContract.toFixed(2)}/contract, collateral $${o.collateralPerContract.toFixed(0)}/contract, APY ${(o.apy * 100).toFixed(1)}%${o.assignProb != null ? `, assignment odds ${(o.assignProb * 100).toFixed(0)}%` : ""}, maker budget $${o.availableUsdc.toFixed(0)}`;
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
        shelfOpen: d.open,
        gates: d.checks.map((c) => ({ gate: c.label, pass: c.pass, detail: c.detail })),
      }),
    };
  }

  if (name === "get_shelf") {
    const scan = await getScan();
    const lines: string[] = [];
    scan.sellablePuts.forEach((o, i) => lines.push(offerLine(`D${i + 1}`, o)));
    scan.sellablePutSpreads.forEach((o, i) => lines.push(offerLine(`S${i + 1}`, o)));
    scan.monthlyIndications.forEach((m, i) =>
      lines.push(
        `M${i + 1} (30d RFQ indication, not directly fillable): put $${m.strike}, ${m.dte.toFixed(1)}d, est. seller premium $${m.estSellerPremium.toFixed(2)}/contract, APY ${(m.apy * 100).toFixed(1)}%${m.assignProb != null ? `, assignment odds ${(m.assignProb * 100).toFixed(0)}%` : ""}`,
      ),
    );
    return {
      result: lines.length
        ? `ETH spot $${scan.spot}. Offer ids (D.., S.., M..) are Monsoon's own labels for this list, not Thetanuts identifiers. Selling an option means: you receive the premium now, your collateral is locked until expiry.\nIMPORTANT: fills are FRACTIONAL. "collateral $X/contract" is per 1.0 contract, not a minimum. Committing any USDC amount (even $10) sells usdc/collateral contracts and earns premium pro-rata. Example: $12 into a put with $2400 collateral and $5 premium per contract sells 0.005 contracts and earns $0.025.\n${lines.join("\n")}`
        : "No live offers right now.",
    };
  }

  if (name === "propose_trade") {
    const offerId = String(args.offerId ?? "").toUpperCase().trim();
    const usdc = Number(args.usdcCollateral);
    if (!offerId || !Number.isFinite(usdc) || usdc <= 0) {
      return { result: "ERROR: offerId and positive usdcCollateral required" };
    }
    const scan = await getScan();
    const m = offerId.match(/^([DS])(\d+)$/);
    if (!m) return { result: `ERROR: ${offerId} is not fillable. Only D.. and S.. offers can be executed; M.. rows are RFQ indications.` };
    const list = m[1] === "D" ? scan.sellablePuts : scan.sellablePutSpreads;
    const offer = list[Number(m[2]) - 1];
    if (!offer) return { result: `ERROR: offer ${offerId} not found; call get_shelf again.` };
    if (usdc > offer.availableUsdc) {
      return { result: `ERROR: maker budget for ${offerId} is $${offer.availableUsdc.toFixed(0)}` };
    }
    const raw = offer.raw as { order: { maker: string; nonce: string } };
    const contracts = usdc / offer.collateralPerContract;
    const premiumReceived = contracts * offer.premiumPerContract;
    const ticket: TradeTicket = {
      offerId,
      kind: offer.kind,
      strikes: offer.strikes,
      expiry: offer.expiry,
      dte: offer.dte,
      premiumPerContract: offer.premiumPerContract,
      collateralPerContract: offer.collateralPerContract,
      usdcCollateral: usdc,
      contracts,
      premiumReceived,
      maxLoss:
        offer.kind === "putSpread" ? usdc - premiumReceived : null,
      matchKey: { maker: raw.order.maker, nonce: String(raw.order.nonce) },
    };
    return {
      result: JSON.stringify({
        ok: true,
        note: "Ticket created and shown to the user with an Execute button. Summarize it: premium received, collateral locked, worst case.",
        ticket: { ...ticket, matchKey: undefined },
      }),
      ticket,
    };
  }

  return { result: `ERROR: unknown tool ${name}` };
}

/** Find the raw signed order for a ticket at execution time. */
export async function findRawOrder(matchKey: { maker: string; nonce: string }) {
  const scan = await scanBook(DEFAULT_PARAMS.haircut);
  const all = [...scan.sellablePuts, ...scan.sellablePutSpreads];
  const hit = all.find((o) => {
    const r = o.raw as { order: { maker: string; nonce: string } };
    return (
      r.order.maker.toLowerCase() === matchKey.maker.toLowerCase() &&
      String(r.order.nonce) === matchKey.nonce
    );
  });
  return hit?.raw ?? null;
}
