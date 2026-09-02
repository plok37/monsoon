// Server-side Thetanuts client singleton on Base with RPC fallback.
import { ThetanutsClient } from "@thetanuts-finance/thetanuts-client";
import { ethers } from "ethers";

const RPCS = [
  "https://mainnet.base.org",
  "https://base-rpc.publicnode.com",
  "https://base.llamarpc.com",
];

let client: ThetanutsClient | null = null;

export async function getThetanutsClient(): Promise<ThetanutsClient> {
  if (client) return client;
  let lastErr: unknown;
  for (const url of RPCS) {
    try {
      const provider = new ethers.JsonRpcProvider(url, 8453, { staticNetwork: true });
      await provider.getBlockNumber();
      client = new ThetanutsClient({ chainId: 8453, provider });
      return client;
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(`no Base RPC reachable: ${lastErr}`);
}
