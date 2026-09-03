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
  const expiryTs = Math.floor(Date.now() / 1000) + params.tenorDays * 86400;

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
  const request = client.optionFactory.buildRFQRequest({
    requester,
    underlying: "ETH",
    optionType: "PUT",
    strikes: params.strike,
    expiry: expiryTs,
    numContracts: contracts,
    isLong: false,
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
