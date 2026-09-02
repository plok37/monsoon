// GET /api/position?address=0x... -> user's Thetanuts positions + trade history
import { NextRequest, NextResponse } from "next/server";
import { getThetanutsClient } from "@/lib/thetanuts/client";

export const revalidate = 0;

const json = (v: unknown) =>
  JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x)));

export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get("address");
  if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
    return NextResponse.json({ error: "valid address required" }, { status: 400 });
  }
  const client = await getThetanutsClient();
  const [positions, history] = await Promise.all([
    client.api.getUserPositionsFromIndexer(address).catch(() => []),
    client.api.getUserHistoryFromIndexer(address).catch(() => []),
  ]);
  return NextResponse.json({ positions: json(positions), history: json(history) });
}
