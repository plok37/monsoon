"use client";

// The wheel's second leg: sell a physically-settled covered call against WETH
// you hold (e.g. from a put assignment), via the same sealed-bid RFQ auction.
// Strategy guard: never sell a call struck below your cost basis.
import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { BrowserProvider, Contract, formatUnits } from "ethers";
import { PhoneOutgoingIcon } from "@phosphor-icons/react";
import { createCoveredCallRfq, settleRfq, cancelRfq, nextPhysicalExpiry, type RfqTicket } from "@/lib/thetanuts/rfq";
import { humanizeExecError } from "@/lib/thetanuts/execute";

const ACTIVE_KEY = "monsoon-cc-active";
const WETH = "0x4200000000000000000000000000000000000006";

const usd = (n: number, dp = 2) =>
  n.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });

interface Eip1193 {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

interface RfqStatus {
  phase: "auction" | "settleable" | "no_bids" | "settled" | "cancelled";
  offerEndTimestamp: number;
  offersMade: number;
  offersRevealed: number;
  bestPricePerContract: number; // WETH per contract for WETH-collateral auctions
}

export function CoveredCallPanel({ spot, suggestedCallUsd }: { spot: number; suggestedCallUsd: number | null }) {
  const { address } = useAccount();
  const [strike, setStrike] = useState(String(Math.round((spot * 1.1) / 50) * 50));
  const [contracts, setContracts] = useState("");
  const [basis, setBasis] = useState("");
  const [minPremiumUsd, setMinPremiumUsd] = useState(
    suggestedCallUsd != null ? String(Math.max(0.01, +(suggestedCallUsd * 0.8).toFixed(2))) : "",
  );
  const [overrideBasis, setOverrideBasis] = useState(false);
  const [ticket, setTicket] = useState<RfqTicket | null>(null);
  const [busy, setBusy] = useState<null | "post" | "settle" | "cancel">(null);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(ACTIVE_KEY);
      if (saved) setTicket(JSON.parse(saved));
    } catch {}
  }, []);

  const { data: wethBalance } = useQuery({
    queryKey: ["weth-balance", address],
    queryFn: async () => {
      const eth = (window as unknown as { ethereum?: Eip1193 }).ethereum;
      if (!eth) return 0;
      const provider = new BrowserProvider(eth as never);
      const c = new Contract(WETH, ["function balanceOf(address) view returns (uint256)"], provider);
      return Number(formatUnits(await c.balanceOf(address!), 18));
    },
    enabled: !!address,
    refetchInterval: 30_000,
  });

  const { data: status } = useQuery({
    queryKey: ["cc-rfq", ticket?.quotationId],
    queryFn: async (): Promise<RfqStatus> => {
      const res = await fetch(`/api/rfq?id=${ticket!.quotationId}`);
      if (!res.ok) throw new Error("status unavailable");
      return res.json();
    },
    enabled: !!ticket && !done,
    refetchInterval: 15_000,
  });

  const k = Number(strike);
  const b = Number(basis);
  const basisViolated = b > 0 && k > 0 && k < b;

  async function post() {
    const n = Number(contracts);
    const pUsd = Number(minPremiumUsd);
    if (!(k > 0) || !(n > 0) || !(pUsd > 0)) return;
    if (basisViolated && !overrideBasis) {
      setErr(`Strategy guard: strike $${k} is below your cost basis $${b}. Selling here locks in a loss if called away. Tick the override to proceed anyway.`);
      return;
    }
    setBusy("post");
    setErr(null);
    try {
      const t = await createCoveredCallRfq({
        strike: k,
        contracts: n,
        // call premiums are denominated in WETH; convert the USD minimum
        reservePremiumWethPerContract: pUsd / spot,
        tenorDays: 30,
        auctionMinutes: 10,
      });
      setTicket(t);
      setDone(null);
      try {
        localStorage.setItem(ACTIVE_KEY, JSON.stringify(t));
      } catch {}
    } catch (e) {
      setErr(humanizeExecError(e));
    } finally {
      setBusy(null);
    }
  }

  async function act(kind: "settle" | "cancel") {
    if (!ticket) return;
    setBusy(kind);
    setErr(null);
    try {
      const hash = kind === "settle" ? await settleRfq(ticket.quotationId) : await cancelRfq(ticket.quotationId);
      setDone(
        kind === "settle"
          ? `Covered call sold on Base mainnet. Tx ${hash.slice(0, 10)}…`
          : `Auction cancelled. Your WETH never moved. Tx ${hash.slice(0, 10)}…`,
      );
      try {
        localStorage.removeItem(ACTIVE_KEY);
      } catch {}
    } catch (e) {
      setErr(humanizeExecError(e));
    } finally {
      setBusy(null);
    }
  }

  const secondsLeft = status ? Math.max(0, status.offerEndTimestamp - Math.floor(Date.now() / 1000)) : 0;

  return (
    <div className="rounded-lg border border-line bg-surface p-5">
      <h3 className="flex items-center gap-2 text-sm font-medium">
        <PhoneOutgoingIcon size={16} weight="fill" className="text-accent" />
        Rent out your ETH (covered call, 30d auction)
      </h3>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        The wheel&apos;s second leg. Market makers bid to buy a call on WETH you hold; expiring{" "}
        <span className="num text-foreground">{new Date(nextPhysicalExpiry(30) * 1000).toUTCString().slice(0, 16)}</span>.
        If ETH ends above your strike, they pay the strike in USDC and take the WETH; otherwise you
        keep the WETH and the premium. Your WETH moves only when you settle a winning bid.
      </p>
      <p className="num mt-2 text-xs text-faint">
        WETH available: {wethBalance != null ? wethBalance.toFixed(4) : "…"}
      </p>

      {!ticket || done ? (
        <>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <label className="text-xs text-faint">
              Strike (USD)
              <input value={strike} onChange={(e) => setStrike(e.target.value)} inputMode="decimal"
                className="num mt-1 w-full rounded-md border border-line bg-background px-3 py-2 text-sm outline-none focus:border-accent-dim" />
            </label>
            <label className="text-xs text-faint">
              WETH to cover
              <input value={contracts} onChange={(e) => setContracts(e.target.value)} inputMode="decimal" placeholder={wethBalance ? wethBalance.toFixed(4) : "0.01"}
                className="num mt-1 w-full rounded-md border border-line bg-background px-3 py-2 text-sm outline-none focus:border-accent-dim" />
            </label>
            <label className="text-xs text-faint">
              Your cost basis (USD)
              <input value={basis} onChange={(e) => setBasis(e.target.value)} inputMode="decimal" placeholder="optional"
                className="num mt-1 w-full rounded-md border border-line bg-background px-3 py-2 text-sm outline-none focus:border-accent-dim" />
            </label>
            <label className="text-xs text-faint">
              Min premium (USD/contract)
              <input value={minPremiumUsd} onChange={(e) => setMinPremiumUsd(e.target.value)} inputMode="decimal"
                className="num mt-1 w-full rounded-md border border-line bg-background px-3 py-2 text-sm outline-none focus:border-accent-dim" />
            </label>
          </div>
          {suggestedCallUsd != null && (
            <p className="mt-2 text-xs text-faint">
              Buyers currently pay ~${usd(suggestedCallUsd)}/contract for nearby calls.
            </p>
          )}
          {basisViolated && (
            <label className="mt-2 flex items-center gap-2 text-xs text-warn">
              <input type="checkbox" checked={overrideBasis} onChange={(e) => setOverrideBasis(e.target.checked)} />
              I understand this strike is below my cost basis and locks in a loss if called away
            </label>
          )}
          <button onClick={post} disabled={busy !== null || !address}
            className="mt-3 rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-ink transition-transform hover:brightness-110 active:scale-[0.98] disabled:opacity-50">
            {busy === "post" ? "Confirm in wallet…" : "Start 10-minute auction"}
          </button>
          {done && <p className="mt-3 break-words text-sm text-accent">{done}</p>}
        </>
      ) : (
        <div className="mt-4">
          <dl className="num grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
            <dt className="font-sans text-faint">Auction</dt>
            <dd className="text-right">#{ticket.quotationId}</dd>
            <dt className="font-sans text-faint">Selling</dt>
            <dd className="text-right">{ticket.contracts.toFixed(4)} × ${usd(ticket.strike, 0)} call</dd>
            <dt className="font-sans text-faint">Status</dt>
            <dd className="text-right">
              {status == null
                ? "checking…"
                : status.phase === "auction"
                  ? `collecting bids · ${Math.floor(secondsLeft / 60)}m ${secondsLeft % 60}s left`
                  : status.phase === "settleable"
                    ? "bid won. Ready to settle"
                    : status.phase === "no_bids"
                      ? "ended with no qualifying bids"
                      : status.phase}
            </dd>
            {status && (
              <>
                <dt className="font-sans text-faint">Bids</dt>
                <dd className="text-right">{status.offersMade} made · {status.offersRevealed} revealed</dd>
                <dt className="font-sans text-faint">Best premium</dt>
                <dd className="text-right text-accent">
                  {status.bestPricePerContract.toFixed(5)} WETH (~${usd(status.bestPricePerContract * spot)})/contract
                </dd>
              </>
            )}
          </dl>
          <div className="mt-4 flex gap-2">
            <button onClick={() => act("settle")}
              disabled={busy !== null || !status || status.phase !== "settleable"}
              className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-ink transition-transform hover:brightness-110 active:scale-[0.98] disabled:opacity-40">
              {busy === "settle" ? "Confirm in wallet…" : "Settle and collect premium"}
            </button>
            <button onClick={() => act("cancel")} disabled={busy !== null}
              className="rounded-md border border-line px-4 py-2 text-sm transition-transform active:scale-[0.98] disabled:opacity-40">
              {busy === "cancel" ? "Confirm in wallet…" : "Cancel auction"}
            </button>
          </div>
        </div>
      )}
      {err && <p className="mt-3 break-words text-sm text-warn">{err}</p>}
    </div>
  );
}
