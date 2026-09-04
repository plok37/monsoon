"use client";

import { useState } from "react";
import { useAccount, useConnect } from "wagmi";
import { UmbrellaIcon, CheckCircleIcon } from "@phosphor-icons/react";
import type { TradeTicket } from "@/lib/copilot/tools";
import { executeFill } from "@/lib/thetanuts/execute";

const usd = (n: number, dp = 2) =>
  n.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });

const KIND_LABEL = {
  put: "buy protective put",
  putSpread: "buy put spread",
  call: "buy call",
} as const;

export function TradeTicketCard({ ticket }: { ticket: TradeTicket }) {
  const { isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const [state, setState] = useState<
    { s: "idle" } | { s: "executing" } | { s: "done"; tx: string } | { s: "error"; msg: string }
  >({ s: "idle" });

  async function run() {
    setState({ s: "executing" });
    try {
      const { txHash } = await executeFill(ticket.matchKey, ticket.usdcSpend);
      setState({ s: "done", tx: txHash });
    } catch (e) {
      setState({ s: "error", msg: e instanceof Error ? e.message : "execution failed" });
    }
  }

  return (
    <div className="rounded-lg border border-accent-dim bg-surface p-4">
      <div className="flex items-center gap-2 text-sm font-medium">
        <UmbrellaIcon size={16} weight="fill" className="text-accent" />
        Trade ticket · {KIND_LABEL[ticket.kind]}
      </div>
      <dl className="num mt-3 grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
        <dt className="font-sans text-faint">Strike{ticket.strikes.length > 1 ? "s" : ""}</dt>
        <dd className="text-right">{ticket.strikes.map((s) => `$${usd(s, 0)}`).join(" / ")}</dd>
        <dt className="font-sans text-faint">Expiry</dt>
        <dd className="text-right">{new Date(ticket.expiry * 1000).toUTCString().slice(5, 16)}</dd>
        <dt className="font-sans text-faint">Contracts</dt>
        <dd className="text-right">{ticket.contracts.toFixed(4)}</dd>
        <dt className="font-sans text-faint">Premium paid</dt>
        <dd className="text-right">${usd(ticket.usdcSpend)}</dd>
        <dt className="font-sans text-faint">Max loss</dt>
        <dd className="text-right">${usd(ticket.maxLoss)} (the premium)</dd>
        <dt className="font-sans text-faint">Max payout</dt>
        <dd className="text-right text-accent">
          {ticket.maxPayout != null ? `$${usd(ticket.maxPayout)}` : "uncapped"}
        </dd>
        <dt className="font-sans text-faint">Breakeven at expiry</dt>
        <dd className="text-right">${usd(ticket.breakeven, 0)}</dd>
      </dl>

      {state.s === "done" ? (
        <a
          href={`https://basescan.org/tx/${state.tx}`}
          target="_blank"
          rel="noreferrer"
          className="mt-4 flex items-center gap-2 text-sm text-accent hover:underline"
        >
          <CheckCircleIcon size={16} weight="fill" />
          Filled on Base mainnet. View transaction
        </a>
      ) : (
        <>
          <button
            onClick={isConnected ? run : () => connect({ connector: connectors[0] })}
            disabled={state.s === "executing"}
            className="mt-4 w-full rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-ink transition-transform hover:brightness-110 active:scale-[0.98] disabled:opacity-50"
          >
            {state.s === "executing"
              ? "Confirm in wallet…"
              : isConnected
                ? "Execute with wallet"
                : "Connect wallet to execute"}
          </button>
          <p className="mt-2 text-xs text-faint">
            Up to 3 wallet confirmations: reserve withdrawal (only if your USDC is short), USDC
            approval (first trade only), then the fill.
          </p>
          {state.s === "error" && (
            <p className="mt-2 break-words text-sm text-warn">{state.msg}</p>
          )}
        </>
      )}
    </div>
  );
}
