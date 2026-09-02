"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { CloudRain } from "@phosphor-icons/react";
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
          <CloudRain size={22} weight="fill" className="text-accent" />
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
            <button
              onClick={() => disconnect()}
              className="num rounded-md border border-line px-3 py-1.5 text-sm text-muted transition-colors hover:text-foreground active:scale-[0.98]"
              title="Disconnect"
            >
              {address.slice(0, 6)}…{address.slice(-4)}
            </button>
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
