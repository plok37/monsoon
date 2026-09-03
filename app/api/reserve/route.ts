// GET /api/reserve -> live Aave v3 Base USDC supply APY (cached 10 min)
import { NextResponse } from "next/server";
import { getThetanutsClient } from "@/lib/thetanuts/client";
import { getReserveApy } from "@/lib/aave";

export const revalidate = 0;

let cached: { apy: number; at: number } | null = null;

export async function GET() {
  if (!cached || Date.now() - cached.at > 10 * 60 * 1000) {
    const client = await getThetanutsClient();
    const apy = await getReserveApy(client.provider);
    cached = { apy, at: Date.now() };
  }
  return NextResponse.json({ apy: cached.apy, source: "aave-v3-base-usdc" });
}
