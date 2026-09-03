"use client";

// The Monsoon reserve: idle USDC supplied to Aave v3 from the user's own
// wallet, accruing while the gates are closed. Non-custodial end to end.
import { useState } from "react";
import { useAccount, useConnect } from "wagmi";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BrowserProvider } from "ethers";
import { DropIcon } from "@phosphor-icons/react";
import {
  getReserveBalances,
  supplyReserve,
  withdrawReserve,
  type ReserveBalances,
} from "@/lib/aave";
import { humanizeExecError } from "@/lib/thetanuts/execute";

const usd = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface Eip1193 {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

async function getSigner() {
  const eth = (window as unknown as { ethereum?: Eip1193 }).ethereum;
  if (!eth) throw new Error("No browser wallet found");
  const provider = new BrowserProvider(eth as never);
  if ((await provider.getNetwork()).chainId !== 8453n) {
    await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x2105" }] });
  }
  return provider.getSigner();
}

export function ReservePanel() {
  const { address, isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState<null | "supply" | "withdraw">(null);
  const [note, setNote] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const { data: apy } = useQuery({
    queryKey: ["reserve-apy"],
    queryFn: async () => (await (await fetch("/api/reserve")).json()).apy as number,
    staleTime: 10 * 60 * 1000,
  });

  const { data: balances } = useQuery({
    queryKey: ["reserve-balances", address],
    queryFn: async (): Promise<ReserveBalances> => {
      const eth = (window as unknown as { ethereum?: Eip1193 }).ethereum;
      if (!eth) throw new Error("no wallet");
      const provider = new BrowserProvider(eth as never);
      return getReserveBalances(provider, address!);
    },
    enabled: !!address,
    refetchInterval: 30_000,
  });

  async function act(kind: "supply" | "withdraw") {
    const value = kind === "withdraw" && amount.trim() === "" ? Infinity : Number(amount);
    if (!Number.isFinite(value) && value !== Infinity) return;
    if (value !== Infinity && value <= 0) return;
    setBusy(kind);
    setNote(null);
    try {
      const signer = await getSigner();
      const hash =
        kind === "supply" ? await supplyReserve(signer, value) : await withdrawReserve(signer, value);
      setNote({ kind: "ok", text: `${kind === "supply" ? "Supplied" : "Withdrawn"}. Tx ${hash.slice(0, 10)}…` });
      setAmount("");
      queryClient.invalidateQueries({ queryKey: ["reserve-balances"] });
    } catch (e) {
      setNote({ kind: "err", text: humanizeExecError(e) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="rounded-lg border border-line bg-surface p-5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-medium">
          <DropIcon size={16} weight="fill" className="text-accent" />
          Your reserve, earning on Aave
        </h3>
        {apy != null && (
          <span className="num text-sm text-accent">{(apy * 100).toFixed(2)}% APY</span>
        )}
      </div>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        Idle USDC goes to Aave v3 on Base from your own wallet and accrues until you underwrite.
        The same market Thetanuts parks option collateral in. Withdraw anytime.
      </p>

      {!isConnected ? (
        <button
          onClick={() => connect({ connector: connectors[0] })}
          className="mt-4 rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-ink transition-transform hover:brightness-110 active:scale-[0.98]"
        >
          Connect wallet to start
        </button>
      ) : (
        <>
          <dl className="num mt-4 grid grid-cols-2 gap-2 text-sm">
            <div>
              <dt className="font-sans text-faint">In your wallet</dt>
              <dd className="mt-0.5 text-lg">${balances ? usd(balances.walletUsdc) : "…"}</dd>
            </div>
            <div>
              <dt className="font-sans text-faint">In the reserve</dt>
              <dd className="mt-0.5 text-lg text-accent">
                ${balances ? usd(balances.reserveUsdc) : "…"}
              </dd>
            </div>
          </dl>

          <div className="mt-4 flex gap-2">
            <label htmlFor="reserve-amount" className="sr-only">
              USDC amount
            </label>
            <input
              id="reserve-amount"
              inputMode="decimal"
              placeholder="USDC amount"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="num w-32 rounded-md border border-line bg-background px-3 py-2 text-sm outline-none placeholder:font-sans placeholder:text-faint focus:border-accent-dim"
            />
            <button
              onClick={() => act("supply")}
              disabled={busy !== null}
              className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-ink transition-transform hover:brightness-110 active:scale-[0.98] disabled:opacity-50"
            >
              {busy === "supply" ? "Confirm in wallet…" : "Supply"}
            </button>
            <button
              onClick={() => act("withdraw")}
              disabled={busy !== null}
              className="rounded-md border border-line px-4 py-2 text-sm text-foreground transition-transform active:scale-[0.98] disabled:opacity-50"
              title="Leave the amount empty to withdraw everything"
            >
              {busy === "withdraw" ? "Confirm in wallet…" : "Withdraw"}
            </button>
          </div>
          <p className="mt-2 text-xs text-faint">
            Withdraw with an empty amount to pull everything back to USDC.
          </p>
          {note && (
            <p className={`mt-2 break-words text-sm ${note.kind === "ok" ? "text-accent" : "text-warn"}`}>
              {note.text}
            </p>
          )}
        </>
      )}
    </div>
  );
}
