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

export async function executeFill(
  matchKey: { maker: string; nonce: string },
  usdcCollateral: number,
): Promise<ExecResult> {
  const eth = (window as unknown as { ethereum?: Eip1193 }).ethereum;
  if (!eth) throw new Error("No browser wallet found");

  // fresh signed order from the book (prices move; never execute a stale one)
  const res = await fetch(`/api/order?maker=${matchKey.maker}&nonce=${matchKey.nonce}`);
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.error ?? `order lookup failed (${res.status})`);
  }
  const { order } = await res.json();

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
