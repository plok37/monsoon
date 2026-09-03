// Client-side trade execution: the user's wallet signs; no server keys.
"use client";

import { BrowserProvider } from "ethers";
import { ThetanutsClient } from "@thetanuts-finance/thetanuts-client";

export interface ExecResult {
  txHash: string;
}

interface Eip1193 {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

/** The SDK's OrderWithSignature carries BigInt fields that arrive as decimal
 *  strings over JSON; revive them before handing the order to the SDK. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function reviveOrder(wire: any): any {
  const o = wire.order ?? {};
  return {
    ...wire,
    availableAmount: BigInt(wire.availableAmount ?? 0),
    order: {
      ...o,
      numContracts: BigInt(o.numContracts ?? 0),
      price: BigInt(o.price ?? 0),
      expiry: BigInt(o.expiry ?? 0),
      nonce: BigInt(o.nonce ?? 0),
      ...(o.strikes ? { strikes: o.strikes.map((s: string) => BigInt(s)) } : {}),
      ...(o.strikePrice != null ? { strikePrice: BigInt(o.strikePrice) } : {}),
      ...(o.deadline != null ? { deadline: BigInt(o.deadline) } : {}),
    },
  };
}

export interface OrderMatchKey {
  maker: string;
  kind: "put" | "putSpread";
  strikes: number[];
  expiry: number;
}

export async function executeFill(
  matchKey: OrderMatchKey,
  usdcCollateral: number,
): Promise<ExecResult> {
  const eth = (window as unknown as { ethereum?: Eip1193 }).ethereum;
  if (!eth) throw new Error("No browser wallet found");

  // fresh signed order from the book (MMs re-sign every ~60s; never execute a stale one)
  const params = new URLSearchParams({
    maker: matchKey.maker,
    kind: matchKey.kind,
    strikes: matchKey.strikes.join(","),
    expiry: String(matchKey.expiry),
  });
  const res = await fetch(`/api/order?${params}`);
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.error ?? `order lookup failed (${res.status})`);
  }
  const { order: wire } = await res.json();
  const order = reviveOrder(wire);

  const provider = new BrowserProvider(eth as never);
  const network = await provider.getNetwork();
  if (network.chainId !== 8453n) {
    await eth.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: "0x2105" }],
    });
  }
  const signer = await provider.getSigner();
  const client = new ThetanutsClient({ chainId: 8453, provider, signer });

  const usdcAmount = BigInt(Math.round(usdcCollateral * 1e6));

  const optionBook = client.chainConfig.contracts.optionBook;
  if (!optionBook) throw new Error("OptionBook is not deployed on this chain");
  await client.erc20.ensureAllowance(
    client.chainConfig.tokens.USDC.address,
    optionBook,
    usdcAmount,
  );

  const staticCheck = await client.optionBook.callStaticFillOrder(order, usdcAmount);
  if (!staticCheck.success) {
    throw new Error(`Fill would revert: ${staticCheck.error || "unknown reason"}`);
  }

  const receipt = await client.optionBook.fillOrder(order, usdcAmount);
  return { txHash: receipt.hash };
}
