// GET /api/order?maker=0x..&nonce=... -> the raw signed OptionBook order, for
// client-side execution. Returns 410 if the order left the book.
import { NextRequest, NextResponse } from "next/server";
import { findRawOrder } from "@/lib/copilot/tools";

export const revalidate = 0;

export async function GET(req: NextRequest) {
  const maker = req.nextUrl.searchParams.get("maker");
  const nonce = req.nextUrl.searchParams.get("nonce");
  if (!maker || !nonce) {
    return NextResponse.json({ error: "maker and nonce required" }, { status: 400 });
  }
  const raw = await findRawOrder({ maker, nonce });
  if (!raw) {
    return NextResponse.json(
      { error: "order no longer on the book; ask the copilot for a fresh shelf" },
      { status: 410 },
    );
  }
  return NextResponse.json({ order: raw });
}
