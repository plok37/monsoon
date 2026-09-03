// GET /api/rfq?id=<quotationId> -> live auction status: phase, bids, best price.
import { NextRequest, NextResponse } from "next/server";
import { getThetanutsClient } from "@/lib/thetanuts/client";

export const revalidate = 0;

const ZERO = "0x0000000000000000000000000000000000000000";

export async function GET(req: NextRequest) {
  const idStr = req.nextUrl.searchParams.get("id");
  if (!idStr || !/^\d+$/.test(idStr)) {
    return NextResponse.json({ error: "numeric id required" }, { status: 400 });
  }
  const id = BigInt(idStr);
  const client = await getThetanutsClient();
  const [q, history] = await Promise.all([
    client.optionFactory.getQuotation(id),
    client.events.getRfqHistory(id).catch(() => null),
  ]);

  const now = Math.floor(Date.now() / 1000);
  const offerEnd = Number(q.params.offerEndTimestamp);
  const optionDeployed = q.state.optionContract !== ZERO;
  const cancelled = history?.cancelled != null;
  const hasWinner = q.state.currentWinner !== ZERO;

  let phase: "auction" | "settleable" | "no_bids" | "settled" | "cancelled";
  if (optionDeployed || history?.settled != null) phase = "settled";
  else if (cancelled || !q.state.isActive) phase = "cancelled";
  else if (now < offerEnd) phase = "auction";
  else phase = hasWinner ? "settleable" : "no_bids";

  // contracts and prices are TOTALS in the collateral token's decimals
  // (verified: USDC put builds use 6dp; WETH-collateral auctions #122/#123 use 18dp)
  const collateral = (q.params.collateral as string).toLowerCase();
  const token = Object.values(client.chainConfig.tokens).find(
    (t) => t.address.toLowerCase() === collateral,
  );
  const dec = token?.decimals ?? 6;
  const contracts = Number(q.params.numContracts) / 10 ** dec;
  const bestTotal = Number(q.state.currentBestPriceOrReserve) / 10 ** dec;

  return NextResponse.json({
    phase,
    offerEndTimestamp: offerEnd,
    offersMade: history?.offersMade.length ?? 0,
    offersRevealed: history?.offersRevealed.length ?? 0,
    currentWinner: hasWinner ? q.state.currentWinner : null,
    // while no bid beats the reserve, this is the reserve itself
    bestPremiumTotal: bestTotal,
    bestPricePerContract: contracts > 0 ? bestTotal / contracts : 0,
    optionContract: optionDeployed ? q.state.optionContract : null,
    strikes: (q.params.strikes ?? []).map((s: bigint) => Number(s) / 1e8),
    contracts,
    expiryTimestamp: Number(q.params.expiryTimestamp),
  });
}
