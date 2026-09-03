// GET /api/order?maker=0x..&kind=put|putSpread&strikes=2420,2400&expiry=1788508800
// -> the CURRENT signed OptionBook order matching that economic identity, plus
// its current premium. MMs re-sign orders every ~60s, so lookups are by
// maker+type+strikes+expiry, never by nonce. 410 if the offer left the book.
import { NextRequest, NextResponse } from "next/server";
import { findRawOrder } from "@/lib/copilot/tools";

export const revalidate = 0;

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const maker = q.get("maker");
  const kind = q.get("kind");
  const strikes = (q.get("strikes") ?? "").split(",").map(Number).filter(Number.isFinite);
  const expiry = Number(q.get("expiry"));
  if (!maker || (kind !== "put" && kind !== "putSpread") || !strikes.length || !Number.isFinite(expiry)) {
    return NextResponse.json(
      { error: "maker, kind, strikes and expiry required" },
      { status: 400 },
    );
  }
  const hit = await findRawOrder({ maker, kind, strikes, expiry });
  if (!hit) {
    return NextResponse.json(
      { error: "this offer has left the book; ask the copilot for a fresh shelf" },
      { status: 410 },
    );
  }
  // Raw SDK orders carry BigInt fields; serialize them as decimal strings.
  // ethers v6 accepts BigNumberish strings, so the client can pass the
  // revived order straight into fillOrder.
  return NextResponse.json(
    JSON.parse(JSON.stringify(hit, (_k, v) => (typeof v === "bigint" ? v.toString() : v))),
  );
}
