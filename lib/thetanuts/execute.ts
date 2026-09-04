// Client-side trade execution (BUY: usdcSpend is the premium paid; the
// OptionBook taker is always the buyer). The user's wallet signs; no server keys.
"use client";

import { BrowserProvider, Contract, formatUnits } from "ethers";
import { MemoryStorageProvider, ThetanutsClient } from "@thetanuts-finance/thetanuts-client";
import { A_BAS_USDC, USDC, withdrawReserve } from "@/lib/aave";

export interface ExecResult {
  txHash: string;
}

/** Turn wallet/RPC errors into one calm sentence. */
export function humanizeExecError(e: unknown): string {
  const err = e as { code?: string | number; message?: string };
  const msg = err?.message ?? String(e);
  if (err?.code === "ACTION_REJECTED" || err?.code === 4001 || /user (rejected|denied)/i.test(msg)) {
    return "You cancelled in the wallet. Nothing was sent; the offer is still here when you are ready.";
  }
  if (/insufficient funds/i.test(msg)) {
    return "Not enough ETH on Base to pay for gas. Top up a little ETH and try again.";
  }
  if (/transfer amount exceeds balance|ERC20: (transfer|burn)/i.test(msg)) {
    return "Not enough USDC on Base for this collateral amount.";
  }
  if (/left the book|order lookup failed/i.test(msg)) {
    return msg;
  }
  if (/wallet_switchEthereumChain|chain/i.test(msg) && /reject/i.test(msg)) {
    return "Switching to Base was declined. Monsoon trades live on Base mainnet.";
  }
  // Unknown: keep the first line only, never a JSON dump.
  return `Execution failed: ${msg.split("(")[0].split("\n")[0].trim().slice(0, 160)}`;
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
  kind: "put" | "putSpread" | "call";
  strikes: number[];
  expiry: number;
}

export async function executeFill(
  matchKey: OrderMatchKey,
  usdcSpend: number,
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
  const owner = await signer.getAddress();

  // Reserve-aware collateral: if the wallet is short on plain USDC but the
  // Aave reserve covers the gap, pull the shortfall out automatically so
  // "Execute" is one gesture, not withdraw-then-retry.
  const bal = new Contract(USDC, ["function balanceOf(address) view returns (uint256)"], provider);
  const aBal = new Contract(A_BAS_USDC, ["function balanceOf(address) view returns (uint256)"], provider);
  const walletUsdc = Number(formatUnits(await bal.balanceOf(owner), 6));
  if (walletUsdc < usdcSpend) {
    const reserveUsdc = Number(formatUnits(await aBal.balanceOf(owner), 6));
    const shortfall = usdcSpend - walletUsdc;
    if (reserveUsdc + 1e-6 < shortfall) {
      throw new Error(
        `Not enough USDC: $${usdcSpend.toFixed(2)} needed, $${walletUsdc.toFixed(2)} in the wallet and $${reserveUsdc.toFixed(2)} in the reserve.`,
      );
    }
    // small buffer so aToken rounding can't leave us a cent short
    await withdrawReserve(signer, Math.min(shortfall + 0.01, reserveUsdc));
  }

  // Monsoon never touches RFQ keys client-side (OptionBook fills only), but the
  // SDK requires an explicit key store in browsers; in-memory satisfies it
  // without persisting anything.
  const client = new ThetanutsClient({
    chainId: 8453,
    provider,
    signer,
    keyStorageProvider: new MemoryStorageProvider(),
  });

  const usdcAmount = BigInt(Math.round(usdcSpend * 1e6));

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
