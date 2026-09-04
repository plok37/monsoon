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

function Field({ label, hint, unit, children }: { label: string; hint?: string; unit?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-medium">{label}</span>
        {unit && <span className="text-xs text-faint">{unit}</span>}
      </div>
      <div className="mt-1.5 rounded-md border border-line bg-background px-3 py-2.5 transition-colors focus-within:border-accent-dim">
        {children}
      </div>
      {hint && <p className="mt-1 text-xs text-faint">{hint}</p>}
    </div>
  );
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
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-base font-semibold tracking-tight">
          <PhoneOutgoingIcon size={18} weight="fill" className="text-accent" />
          Rent out your ETH
        </h3>
        <span className="rounded bg-surface-raised px-2 py-0.5 text-xs text-faint">covered call · sealed-bid auction</span>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        The wheel&apos;s second leg: market makers compete for 10 minutes to buy a call on WETH you hold.
        You keep the premium either way; the WETH is sold at your strike only if ETH ends above it.
      </p>
      <dl className="mt-4 grid gap-3 rounded-md bg-surface-raised px-4 py-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-xs text-faint">Expires</dt>
          <dd className="num mt-0.5">{new Date(nextPhysicalExpiry(30) * 1000).toUTCString().slice(0, 16)}</dd>
        </div>
        <div>
          <dt className="text-xs text-faint">If called away</dt>
          <dd className="mt-0.5">buyer pays your strike in USDC</dd>
        </div>
        <div>
          <dt className="text-xs text-faint">Your WETH</dt>
          <dd className="num mt-0.5">{wethBalance != null ? `${wethBalance.toFixed(4)} available` : "connect to check"}; moves only when you settle</dd>
        </div>
      </dl>

      {!ticket || done ? (
        <>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <Field label="Strike" hint="the price a buyer may purchase your ETH at" unit="USD">
              <input value={strike} onChange={(e) => setStrike(e.target.value)} inputMode="decimal"
                className="num w-full bg-transparent text-base outline-none" />
            </Field>
            <Field label="WETH to cover" hint={wethBalance != null ? `${wethBalance.toFixed(4)} available` : "locked only if a bid wins"} unit="WETH">
              <input value={contracts} onChange={(e) => setContracts(e.target.value)} inputMode="decimal" placeholder={wethBalance ? Math.min(wethBalance, 0.05).toFixed(4) : "0.01"}
                className="num w-full bg-transparent text-base outline-none placeholder:text-faint" />
            </Field>
            <Field label="Your cost basis" hint="what you paid per ETH; guards the strike" unit="USD">
              <input value={basis} onChange={(e) => setBasis(e.target.value)} inputMode="decimal" placeholder="optional"
                className="num w-full bg-transparent text-base outline-none placeholder:text-faint" />
            </Field>
            <Field label="Minimum premium" hint={suggestedCallUsd != null ? `per contract; buyers pay ~$${usd(suggestedCallUsd)} nearby` : "per contract; bids below it never win"} unit="USD">
              <input value={minPremiumUsd} onChange={(e) => setMinPremiumUsd(e.target.value)} inputMode="decimal"
                className="num w-full bg-transparent text-base outline-none" />
            </Field>
          </div>

          {Number(contracts) > 0 && k > 0 && Number(minPremiumUsd) > 0 && (
            <p className="mt-4 rounded-md bg-surface-raised px-3 py-2 text-sm text-muted">
              Offering <span className="num text-foreground">{Number(contracts).toFixed(4)}</span> ×{" "}
              <span className="num text-foreground">${usd(k, 0)}</span> call · at least{" "}
              <span className="num text-accent">${usd(Number(minPremiumUsd) * Number(contracts))}</span> total premium ·
              if called away you receive <span className="num text-foreground">${usd(k * Number(contracts))}</span>
            </p>
          )}

          {basisViolated && (
            <label className="mt-3 flex items-start gap-2 text-sm text-warn">
              <input type="checkbox" checked={overrideBasis} onChange={(e) => setOverrideBasis(e.target.checked)} className="mt-0.5" />
              This strike is below my cost basis of ${usd(b, 0)}; being called away locks in a loss, and I want to proceed anyway.
            </label>
          )}
          <button onClick={post} disabled={busy !== null || !address}
            className="mt-4 rounded-md bg-accent px-5 py-2.5 text-sm font-medium text-accent-ink transition-transform hover:brightness-110 active:scale-[0.98] disabled:opacity-50">
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
