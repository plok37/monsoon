// RFQ seller flow (client-side): post a sealed-bid auction to sell a 30-day
// cash-secured ETH put, watch bids arrive, settle or cancel.
//
// Collateral is only pulled at settlement, so an expired auction with no bids
// costs nothing but the gas that posted it.
"use client";

import { BrowserProvider, Contract } from "ethers";
import { LocalStorageProvider, ThetanutsClient } from "@thetanuts-finance/thetanuts-client";
import { USDC } from "@/lib/aave";

interface Eip1193 {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

async function getBrowserClient(): Promise<ThetanutsClient> {
  const eth = (window as unknown as { ethereum?: Eip1193 }).ethereum;
  if (!eth) throw new Error("No browser wallet found");
  const provider = new BrowserProvider(eth as never);
  if ((await provider.getNetwork()).chainId !== 8453n) {
    await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x2105" }] });
  }
  const signer = await provider.getSigner();
  // LocalStorage keeps the ECDH keypair across reloads so a running auction
  // stays readable. The key only decrypts sealed bid amounts - it cannot
  // move funds - which is why plaintext storage is acceptable here.
  return new ThetanutsClient({
    chainId: 8453,
    provider,
    signer,
    keyStorageProvider: new LocalStorageProvider(),
  });
}

export interface RfqTicket {
  quotationId: string;
  strike: number;
  contracts: number;
  collateralUsdc: number;
  reservePremiumPerContract: number;
  expiryTs: number;
  offerEndTs: number;
  txHash: string;
}

/** First Friday 08:00 UTC at least `minDays` away (physical options expire
 *  only at that moment). For a 30-day request this lands 30-36 days out. */
export function nextPhysicalExpiry(minDays: number): number {
  const d = new Date(Date.now() + minDays * 86400_000);
  d.setUTCHours(8, 0, 0, 0);
  while (d.getUTCDay() !== 5 || d.getTime() <= Date.now() + minDays * 86400_000) {
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return Math.floor(d.getTime() / 1000);
}

export async function createSellPutRfq(params: {
  strike: number;
  collateralUsdc: number;
  reservePremiumPerContract: number;
  tenorDays: number;
  auctionMinutes: number;
}): Promise<RfqTicket> {
  const client = await getBrowserClient();
  const requester = (await client.signer!.getAddress()) as `0x${string}`;
  const contracts = params.collateralUsdc / params.strike;
  const expiryTs = nextPhysicalExpiry(params.tenorDays);

  // approve collateral to the OptionFactory now; it is pulled only at settlement
  const factory = client.chainConfig.contracts.optionFactory;
  if (!factory) throw new Error("OptionFactory is not deployed on this chain");
  const amount = BigInt(Math.ceil(params.collateralUsdc * 1e6));
  const usdc = new Contract(
    USDC,
    ["function allowance(address,address) view returns (uint256)", "function approve(address,uint256) returns (bool)"],
    client.signer,
  );
  if ((await usdc.allowance(requester, factory)) < amount) {
    const tx = await usdc.approve(factory, amount);
    await tx.wait();
  }

  const keyPair = await client.rfqKeys.getOrCreateKeyPair();
  // PHYSICAL settlement: if assigned, the buyer delivers WETH and takes the
  // strike in USDC - the seller ends up holding real ETH, which is what lets
  // the wheel's covered-call phase exist at all.
  const request = client.optionFactory.buildPhysicalOptionRFQ({
    requester,
    underlying: "ETH",
    optionType: "PUT",
    strike: params.strike,
    expiry: expiryTs,
    numContracts: contracts,
    isLong: false,
    deliveryToken: client.chainConfig.tokens.WETH.address as `0x${string}`,
    offerDeadlineMinutes: params.auctionMinutes,
    collateralToken: "USDC",
    reservePrice: params.reservePremiumPerContract,
    requesterPublicKey: keyPair.compressedPublicKey,
  });

  const receipt = await client.optionFactory.requestForQuotation(request);

  const events = await client.events.getQuotationRequestedEvents({
    fromBlock: receipt.blockNumber,
    toBlock: receipt.blockNumber,
  });
  const mine = events.find(
    (e) => e.requester.toLowerCase() === requester.toLowerCase() && e.transactionHash === receipt.hash,
  ) ?? events.find((e) => e.requester.toLowerCase() === requester.toLowerCase());
  if (!mine) throw new Error("Auction posted but its id was not found in the block events; check /position later");

  return {
    quotationId: mine.quotationId.toString(),
    strike: params.strike,
    contracts,
    collateralUsdc: params.collateralUsdc,
    reservePremiumPerContract: params.reservePremiumPerContract,
    expiryTs,
    offerEndTs: Math.floor(Date.now() / 1000) + params.auctionMinutes * 60,
    txHash: receipt.hash,
  };
}

/** Covered call: sell a physically-settled CALL against WETH the user holds.
 *  Collateral = 1 WETH per contract (approved here, pulled only at settlement).
 *  If exercised, the buyer pays strike x contracts in USDC and takes the WETH.
 *  reservePremiumWethPerContract is the minimum premium in WETH per contract
 *  (call premiums are quoted in the collateral token). */
export async function createCoveredCallRfq(params: {
  strike: number;
  contracts: number; // WETH covered (fractional fine)
  reservePremiumWethPerContract: number;
  tenorDays: number;
  auctionMinutes: number;
}): Promise<RfqTicket> {
  const client = await getBrowserClient();
  const requester = (await client.signer!.getAddress()) as `0x${string}`;
  const expiryTs = nextPhysicalExpiry(params.tenorDays);

  const factory = client.chainConfig.contracts.optionFactory;
  if (!factory) throw new Error("OptionFactory is not deployed on this chain");
  const weth = client.chainConfig.tokens.WETH.address;
  const amount = BigInt(Math.ceil(params.contracts * 1e18));
  const wethC = new Contract(
    weth,
    ["function allowance(address,address) view returns (uint256)", "function approve(address,uint256) returns (bool)", "function balanceOf(address) view returns (uint256)"],
    client.signer,
  );
  if ((await wethC.balanceOf(requester)) < amount) {
    throw new Error(`Not enough WETH: covering ${params.contracts} contracts needs ${params.contracts} WETH`);
  }
  if ((await wethC.allowance(requester, factory)) < amount) {
    const tx = await wethC.approve(factory, amount);
    await tx.wait();
  }

  const keyPair = await client.rfqKeys.getOrCreateKeyPair();
  const request = client.optionFactory.buildPhysicalOptionRFQ({
    requester,
    underlying: "ETH",
    optionType: "CALL",
    strike: params.strike,
    expiry: expiryTs,
    numContracts: params.contracts,
    isLong: false,
    deliveryToken: client.chainConfig.tokens.USDC.address as `0x${string}`,
    offerDeadlineMinutes: params.auctionMinutes,
    collateralToken: "WETH",
    reservePrice: params.reservePremiumWethPerContract,
    requesterPublicKey: keyPair.compressedPublicKey,
  });

  const receipt = await client.optionFactory.requestForQuotation(request);
  const events = await client.events.getQuotationRequestedEvents({
    fromBlock: receipt.blockNumber,
    toBlock: receipt.blockNumber,
  });
  const mine =
    events.find((e) => e.requester.toLowerCase() === requester.toLowerCase() && e.transactionHash === receipt.hash) ??
    events.find((e) => e.requester.toLowerCase() === requester.toLowerCase());
  if (!mine) throw new Error("Auction posted but its id was not found in the block events; check /position later");

  return {
    quotationId: mine.quotationId.toString(),
    strike: params.strike,
    contracts: params.contracts,
    collateralUsdc: 0,
    reservePremiumPerContract: params.reservePremiumWethPerContract,
    expiryTs,
    offerEndTs: Math.floor(Date.now() / 1000) + params.auctionMinutes * 60,
    txHash: receipt.hash,
  };
}

export async function settleRfq(quotationId: string): Promise<string> {
  const client = await getBrowserClient();
  const receipt = await client.optionFactory.settleQuotation(BigInt(quotationId));
  return receipt.hash;
}

export async function cancelRfq(quotationId: string): Promise<string> {
  const client = await getBrowserClient();
  const receipt = await client.optionFactory.cancelQuotation(BigInt(quotationId));
  return receipt.hash;
}
