"use client";

import { useAccount, useConnect } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { VaultIcon } from "@phosphor-icons/react";
import { CoveredCallPanel } from "./covered-call-panel";
import type { ShelfLive } from "@/lib/types";

interface ApiPosition {
  id: string;
  optionAddress: string;
  side: "buyer" | "seller";
  amount: string;
  entryPrice: string;
  currentValue: string;
  pnl: string;
  option: {
    underlying: string;
    collateral: string;
    strikes: string[];
    expiry: number;
    optionType: number;
  };
  status: string;
}

interface ApiHistory {
  id: string;
  timestamp: number;
  txHash: string;
  type: string;
  amount: string;
  price: string;
  option: { address: string; underlying: string; expiry: number };
  status: string;
}

function fmtUnits(raw: string, decimals: number, dp = 4): string {
  try {
    const v = BigInt(raw);
    const base = 10n ** BigInt(decimals);
    const whole = v / base;
    const frac = (v < 0n ? -v : v) % base;
    const fracStr = frac.toString().padStart(decimals, "0").slice(0, dp);
    return `${whole}${dp > 0 ? "." + fracStr : ""}`;
  } catch {
    return raw;
  }
}

export function PositionView() {
  const { address, isConnected } = useAccount();
  const { connect, connectors } = useConnect();

  const { data: shelf } = useQuery({
    queryKey: ["shelf", false, false],
    queryFn: async () => {
      const res = await fetch("/api/shelf");
      if (!res.ok) throw new Error("shelf api failed");
      return (await res.json()) as ShelfLive;
    },
    staleTime: 60_000,
  });

  const { data, isPending, isError } = useQuery({
    queryKey: ["position", address],
    queryFn: async () => {
      const res = await fetch(`/api/position?address=${address}`);
      if (!res.ok) throw new Error("position api failed");
      return res.json() as Promise<{ positions: ApiPosition[]; history: ApiHistory[] }>;
    },
    enabled: !!address,
    refetchInterval: 60_000,
  });

  if (!isConnected) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-28 text-center">
        <VaultIcon size={40} className="mx-auto text-faint" />
        <h1 className="mt-4 text-2xl font-semibold tracking-tight">Your underwriting book</h1>
        <p className="mx-auto mt-2 max-w-sm text-muted">
          Connect a wallet to see the options you have written, collateral locked, and premiums
          collected.
        </p>
        <button
          onClick={() => connect({ connector: connectors[0] })}
          className="mt-6 rounded-md bg-accent px-5 py-2 text-sm font-medium text-accent-ink transition-transform hover:brightness-110 active:scale-[0.98]"
        >
          Connect wallet
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 pb-20 pt-16">
      <h1 className="text-3xl font-semibold tracking-tighter md:text-4xl">Your underwriting book</h1>
      <p className="num mt-2 text-sm text-faint">{address}</p>

      {shelf && (
        <div className="mt-8 max-w-2xl">
          <CoveredCallPanel
            spot={shelf.spot}
            suggestedCallUsd={(() => {
              const c = shelf.offers.calls.filter((o) => o.dte >= 5 && o.strikes[0] > shelf.spot);
              return c.length ? c[0].premiumPerContract : null;
            })()}
          />
        </div>
      )}

      {isPending && (
        <div className="mt-10 animate-pulse space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-14 rounded-lg bg-surface" />
          ))}
        </div>
      )}

      {isError && (
        <p className="mt-10 text-muted">
          Could not load positions from the Thetanuts indexer. It may be catching up; try again in a
          minute.
        </p>
      )}

      {data && data.positions.length === 0 && (
        <div className="mt-10 rounded-lg border border-line bg-surface p-8 text-center">
          <p className="text-muted">No open positions yet.</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-faint">
            When you underwrite from the shelf or through the copilot, the position, its collateral,
            and its expiry show up here.
          </p>
        </div>
      )}

      {data && data.positions.length > 0 && (
        <div className="mt-8 overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-sm">
            <thead className="bg-surface text-left text-faint">
              <tr>
                <th className="px-4 py-2.5 font-normal">Side</th>
                <th className="px-4 py-2.5 font-normal">Type</th>
                <th className="px-4 py-2.5 text-right font-normal">Strike(s)</th>
                <th className="px-4 py-2.5 text-right font-normal">Contracts</th>
                <th className="px-4 py-2.5 text-right font-normal">Expiry</th>
                <th className="px-4 py-2.5 text-right font-normal">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.positions.map((p) => (
                <tr key={p.id} className="border-t border-line">
                  <td className="px-4 py-2.5">
                    <span className={p.side === "seller" ? "text-accent" : "text-foreground"}>
                      {p.side === "seller" ? "Underwriter" : "Holder"}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-muted">
                    {p.option.optionType === 0 ? "Call" : "Put"}
                  </td>
                  <td className="num px-4 py-2.5 text-right">
                    {p.option.strikes.map((s) => `$${fmtUnits(s, 8, 0)}`).join(" / ")}
                  </td>
                  <td className="num px-4 py-2.5 text-right">{fmtUnits(p.amount, 8, 4)}</td>
                  <td className="num px-4 py-2.5 text-right">
                    {new Date(p.option.expiry * 1000).toISOString().slice(0, 10)}
                  </td>
                  <td className="px-4 py-2.5 text-right text-muted">{p.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data && data.history.length > 0 && (
        <section className="mt-12">
          <h2 className="text-xl font-semibold tracking-tight">Trade history</h2>
          <div className="mt-4 overflow-x-auto rounded-lg border border-line">
            <table className="w-full text-sm">
              <thead className="bg-surface text-left text-faint">
                <tr>
                  <th className="px-4 py-2.5 font-normal">When</th>
                  <th className="px-4 py-2.5 font-normal">Action</th>
                  <th className="px-4 py-2.5 text-right font-normal">Contracts</th>
                  <th className="px-4 py-2.5 text-right font-normal">Tx</th>
                </tr>
              </thead>
              <tbody>
                {data.history.slice(0, 20).map((h) => (
                  <tr key={h.id} className="border-t border-line">
                    <td className="num px-4 py-2.5">
                      {new Date(h.timestamp * 1000).toISOString().replace("T", " ").slice(0, 16)}
                    </td>
                    <td className="px-4 py-2.5 capitalize text-muted">{h.type}</td>
                    <td className="num px-4 py-2.5 text-right">{fmtUnits(h.amount, 8, 4)}</td>
                    <td className="num px-4 py-2.5 text-right">
                      <a
                        href={`https://basescan.org/tx/${h.txHash}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-accent hover:underline"
                      >
                        {h.txHash.slice(0, 10)}…
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
