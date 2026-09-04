"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { CloudRainIcon, CopyIcon, ArrowSquareOutIcon, PlugsIcon, CaretDownIcon } from "@phosphor-icons/react";
import { ThemeToggle } from "@/components/theme-toggle";

const links = [
  { href: "/", label: "Shelf" },
  { href: "/position", label: "Position" },
  { href: "/copilot", label: "Copilot" },
  { href: "/evidence", label: "Evidence" },
] as const;

export function Nav() {
  const pathname = usePathname();
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-background/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-8 px-4">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <CloudRainIcon size={22} weight="fill" className="text-accent" />
          Monsoon
        </Link>
        <nav className="flex items-center gap-1 text-sm">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`rounded-md px-3 py-1.5 transition-colors ${
                pathname === l.href
                  ? "bg-surface-raised text-foreground"
                  : "text-muted hover:text-foreground"
              }`}
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle></ThemeToggle>
          {isConnected && address ? (
            <WalletMenu address={address} onDisconnect={() => disconnect()} />
          ) : (
            <button
              onClick={() => connect({ connector: connectors[0] })}
              disabled={isPending || connectors.length === 0}
              className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-accent-ink transition-transform hover:brightness-110 active:scale-[0.98] disabled:opacity-50"
            >
              {isPending ? "Connecting" : "Connect wallet"}
            </button>
          )}
        </div>
      </div>
    </header>
  );
}

function WalletMenu({ address, onDisconnect }: { address: string; onDisconnect: () => void }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="num flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-sm text-muted transition-colors hover:text-foreground active:scale-[0.98]"
        aria-expanded={open}
      >
        {address.slice(0, 6)}…{address.slice(-4)}
        <CaretDownIcon size={12} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-52 rounded-lg border border-line bg-surface p-1.5 shadow-lg">
          <button
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(address);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              } catch {}
            }}
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-muted transition-colors hover:bg-surface-raised hover:text-foreground"
          >
            <CopyIcon size={15} />
            {copied ? "Copied" : "Copy address"}
          </button>
          <a
            href={`https://basescan.org/address/${address}`}
            target="_blank"
            rel="noreferrer"
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-muted transition-colors hover:bg-surface-raised hover:text-foreground"
          >
            <ArrowSquareOutIcon size={15} />
            View on Basescan
          </a>
          <button
            onClick={() => {
              setOpen(false);
              onDisconnect();
            }}
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-warn transition-colors hover:bg-surface-raised"
          >
            <PlugsIcon size={15} />
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}
