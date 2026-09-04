"use client";

// The real 30-day underwriting flow: post a sealed-bid RFQ auction on
// Thetanuts OptionFactory, watch bids arrive, settle or cancel.
import { useEffect, useState } from "react";
import { useAccount, useConnect } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { GavelIcon } from "@phosphor-icons/react";
import { createSellPutRfq, settleRfq, cancelRfq, nextPhysicalExpiry, type RfqTicket } from "@/lib/thetanuts/rfq";
import { humanizeExecError } from "@/lib/thetanuts/execute";

const ACTIVE_KEY = "monsoon-rfq-active";

const usd = (n: number, dp = 2) =>
  n.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });

interface RfqStatus {
  phase: "auction" | "settleable" | "no_bids" | "settled" | "cancelled";
  offerEndTimestamp: number;
  offersMade: number;
  offersRevealed: number;
  bestPricePerContract: number;
  optionContract: string | null;
}

export function RfqUnderwrite({
  defaultStrike,
  suggestedPremium,
}: {
  defaultStrike: number;
  suggestedPremium: number; // per contract, from live MM asks minus haircut
}) {
  const { isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const [strike, setStrike] = useState(String(Math.round(defaultStrike)));
  const [usdcAmount, setUsdcAmount] = useState("25");
  const [reserve, setReserve] = useState(String(Math.max(0.01, +(suggestedPremium * 0.8).toFixed(2))));
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

  const { data: status } = useQuery({
    queryKey: ["rfq", ticket?.quotationId],
    queryFn: async (): Promise<RfqStatus> => {
      const res = await fetch(`/api/rfq?id=${ticket!.quotationId}`);
      if (!res.ok) throw new Error("status unavailable");
      return res.json();
    },
    enabled: !!ticket && !done,
    refetchInterval: 15_000,
  });

  async function post() {
    const k = Number(strike);
    const a = Number(usdcAmount);
    const r = Number(reserve);
    if (!(k > 0) || !(a > 0) || !(r > 0)) return;
    setBusy("post");
    setErr(null);
    try {
      const t = await createSellPutRfq({
        strike: k,
        collateralUsdc: a,
        reservePremiumPerContract: r,
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
          ? `Settled on Base mainnet. You are now an underwriter. Tx ${hash.slice(0, 10)}…`
          : `Auction cancelled. Nothing was locked. Tx ${hash.slice(0, 10)}…`,
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
    <div id="rfq-panel" className="rounded-lg border border-line bg-surface p-5">
      <h3 className="flex items-center gap-2 text-sm font-medium">
        <GavelIcon size={16} weight="fill" className="text-accent" />
        Underwrite for 30 days (live RFQ auction)
      </h3>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        Post a sealed-bid auction: market makers compete to buy your put, expiring{" "}
        <span className="num text-foreground">
          {new Date(nextPhysicalExpiry(30) * 1000).toUTCString().slice(0, 16)}
        </span>
        . Physically settled: if assigned, you receive real ETH at your strike, ready for the
        covered-call phase. Your USDC is pulled only if a bid meets your minimum premium and you
        settle. No bids means nothing happens.
      </p>

      {!ticket || done ? (
        <>
          <div className="mt-4 grid grid-cols-3 gap-2">
            <label className="text-xs text-faint">
              Strike (USD)
              <input value={strike} onChange={(e) => setStrike(e.target.value)} inputMode="decimal"
                className="num mt-1 w-full rounded-md border border-line bg-background px-3 py-2 text-sm outline-none focus:border-accent-dim" />
            </label>
            <label className="text-xs text-faint">
              Collateral (USDC)
              <input value={usdcAmount} onChange={(e) => setUsdcAmount(e.target.value)} inputMode="decimal"
                className="num mt-1 w-full rounded-md border border-line bg-background px-3 py-2 text-sm outline-none focus:border-accent-dim" />
            </label>
            <label className="text-xs text-faint">
              Min premium / contract
              <input value={reserve} onChange={(e) => setReserve(e.target.value)} inputMode="decimal"
                className="num mt-1 w-full rounded-md border border-line bg-background px-3 py-2 text-sm outline-none focus:border-accent-dim" />
            </label>
          </div>
          <p className="mt-2 text-xs text-faint">
            {Number(usdcAmount) > 0 && Number(strike) > 0
              ? `${(Number(usdcAmount) / Number(strike)).toFixed(4)} contracts. Live MM asks suggest ~$${usd(suggestedPremium)}/contract is achievable.`
              : "Fractional contracts are fine."}
          </p>
          {!isConnected ? (
            <button onClick={() => connect({ connector: connectors[0] })}
              className="mt-3 rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-ink transition-transform hover:brightness-110 active:scale-[0.98]">
              Connect wallet
            </button>
          ) : (
            <button onClick={post} disabled={busy !== null}
              className="mt-3 rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-ink transition-transform hover:brightness-110 active:scale-[0.98] disabled:opacity-50">
              {busy === "post" ? "Confirm in wallet…" : "Start 10-minute auction"}
            </button>
          )}
          {done && <p className="mt-3 break-words text-sm text-accent">{done}</p>}
        </>
      ) : (
        <div className="mt-4">
          <dl className="num grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
            <dt className="font-sans text-faint">Auction</dt>
            <dd className="text-right">#{ticket.quotationId}</dd>
            <dt className="font-sans text-faint">Selling</dt>
            <dd className="text-right">{ticket.contracts.toFixed(4)} × ${usd(ticket.strike, 0)} put</dd>
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
                <dd className="text-right text-accent">${usd(status.bestPricePerContract)}/contract</dd>
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
