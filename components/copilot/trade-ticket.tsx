"use client";

import { useState } from "react";
import { useAccount, useConnect } from "wagmi";
import { LightningIcon, CheckCircleIcon } from "@phosphor-icons/react";
import type { TradeTicket } from "@/lib/copilot/tools";
import { executeFill, humanizeExecError } from "@/lib/thetanuts/execute";

const usd = (n: number, dp = 2) =>
  n.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });

export function TradeTicketCard({ ticket }: { ticket: TradeTicket }) {
  const { isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const [state, setState] = useState<
    { s: "idle" } | { s: "executing" } | { s: "done"; tx: string } | { s: "error"; msg: string }
  >({ s: "idle" });

  async function run() {
    setState({ s: "executing" });
    try {
      const { txHash } = await executeFill(ticket.matchKey, ticket.usdcCollateral);
      setState({ s: "done", tx: txHash });
    } catch (e) {
      setState({ s: "error", msg: humanizeExecError(e) });
    }
  }

  return (
    <div className="rounded-lg border border-accent-dim bg-surface p-4">
      <div className="flex items-center gap-2 text-sm font-medium">
        <LightningIcon size={16} weight="fill" className="text-accent" />
        Trade ticket · {ticket.kind === "put" ? "sell cash-secured put" : "sell put spread"}
      </div>
      <dl className="num mt-3 grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
        <dt className="font-sans text-faint">Strike{ticket.strikes.length > 1 ? "s" : ""}</dt>
        <dd className="text-right">{ticket.strikes.map((s) => `$${usd(s, 0)}`).join(" / ")}</dd>
        <dt className="font-sans text-faint">Expiry</dt>
        <dd className="text-right">{new Date(ticket.expiry * 1000).toUTCString().slice(5, 16)}</dd>
        <dt className="font-sans text-faint">Collateral locked</dt>
        <dd className="text-right">${usd(ticket.usdcCollateral)}</dd>
        <dt className="font-sans text-faint">Premium received</dt>
        <dd className="text-right text-accent">${usd(ticket.premiumReceived)}</dd>
        <dt className="font-sans text-faint">Worst case</dt>
        <dd className="text-right">
          {ticket.maxLoss != null
            ? `-$${usd(ticket.maxLoss)}`
            : `own ETH at $${usd(ticket.strikes[0], 0)}`}
        </dd>
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
            Your wallet will ask you to confirm each step: reserve withdrawal (only if your USDC
            balance is short), a one-time USDC approval, then the fill. Rejecting any step stops
            everything safely.
          </p>
          {state.s === "error" && (
            <p className="mt-2 break-words text-sm text-warn">{state.msg}</p>
          )}
        </>
      )}
    </div>
  );
}
