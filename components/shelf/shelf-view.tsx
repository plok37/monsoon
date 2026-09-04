"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion, useReducedMotion } from "motion/react";
import { CloudSunIcon, CloudLightningIcon, ArrowCounterClockwiseIcon } from "@phosphor-icons/react";
import type { ShelfResponse, OfferView, MonthlyIndicationView } from "@/lib/types";
import { GateChecklist } from "./gate-checklist";
import { OfferCard } from "./offer-card";
import { ReservePanel } from "@/components/reserve/reserve-panel";
import { RfqUnderwrite } from "@/components/rfq/rfq-underwrite";

const DEMO_DATE = "2022-06-18";

const fmtUsd = (n: number, dp = 0) =>
  n.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });

async function fetchShelf(demo: boolean, force = false): Promise<ShelfResponse> {
  const res = await fetch(
    demo ? `/api/shelf?demo=${DEMO_DATE}` : force ? "/api/shelf?force=open" : "/api/shelf",
  );
  if (!res.ok) throw new Error(`shelf api ${res.status}`);
  return res.json();
}

export function ShelfView() {
  const [demo, setDemo] = useState(false);
  const [force, setForce] = useState(false);
  useEffect(() => {
    try {
      setForce(new URLSearchParams(window.location.search).get("force") === "open");
    } catch {}
  }, []);
  const reduce = useReducedMotion();
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ["shelf", demo, force],
    queryFn: () => fetchShelf(demo, force),
    refetchInterval: demo ? false : 60_000,
  });
  const { data: reserveApy } = useQuery({
    queryKey: ["reserve-apy"],
    queryFn: async () => (await (await fetch("/api/reserve")).json()).apy as number,
    staleTime: 10 * 60 * 1000,
  });

  if (isPending) return <ShelfSkeleton />;
  if (isError || !data) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-24 text-center">
        <p className="text-muted">Could not reach the market. Base RPC or data feeds may be busy.</p>
        <button
          onClick={() => refetch()}
          className="mt-4 rounded-md border border-line px-4 py-2 text-sm text-foreground transition-transform active:scale-[0.98]"
        >
          Try again
        </button>
      </div>
    );
  }

  const open = data.decision.open;
  const spot = data.mode === "live" ? data.spot : data.snapshot.spot;

  return (
    <div className="mx-auto max-w-6xl px-4 pb-20">
      {/* condition banner */}
      <motion.section
        key={`${data.mode}-${open}`}
        initial={reduce ? false : { opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="grid gap-10 pb-12 pt-16 lg:grid-cols-[1fr_auto] lg:items-end"
      >
        <div>
          <div className="flex items-center gap-2 text-sm text-muted">
            {open ? (
              <CloudLightningIcon size={18} weight="fill" className="text-accent" />
            ) : (
              <CloudSunIcon size={18} className="text-faint" />
            )}
            {data.mode === "demo" ? `Replaying ${data.date}` : "Live on Base mainnet"}
            {data.mode === "live" && data.forced === true && (
              <span className="rounded bg-surface-raised px-2 py-0.5 text-xs text-warn">
                gates overridden for preview
              </span>
            )}
          </div>
          <h1 className="mt-3 max-w-xl text-4xl font-semibold tracking-tighter md:text-5xl">
            {open ? "The storm is here. Underwriting is open." : "Calm skies. Underwriting is closed."}
          </h1>
          <p className="mt-4 max-w-md leading-relaxed text-muted">
            {open
              ? "Insurance is expensive and the strikes are historically cheap. This is when Monsoon sells."
              : "Monsoon sells ETH insurance only when it pays. Until then, the reserve earns quiet yield."}
          </p>
        </div>
        <dl className="flex gap-8 lg:justify-end">
          <div>
            <dt className="text-sm text-faint">ETH spot</dt>
            <dd className="num mt-1 text-2xl font-semibold">${fmtUsd(spot)}</dd>
          </div>
          <div>
            <dt className="text-sm text-faint">Implied vol</dt>
            <dd className="num mt-1 text-2xl font-semibold">
              {(data.snapshot.sigma * 100).toFixed(0)}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-faint">Reserve yield</dt>
            <dd className="num mt-1 text-2xl font-semibold text-accent">
              {reserveApy != null ? `${(reserveApy * 100).toFixed(2)}%` : "…"}
            </dd>
          </div>
        </dl>
      </motion.section>

      <GateChecklist decision={data.decision} />

      {/* demo toggle */}
      <div className="mt-6 flex items-center justify-end">
        <button
          onClick={() => setDemo((d) => !d)}
          className="flex items-center gap-2 rounded-md border border-line px-3 py-1.5 text-sm text-muted transition-colors hover:text-foreground active:scale-[0.98]"
        >
          <ArrowCounterClockwiseIcon size={16} />
          {demo ? "Back to live market" : "Replay June 2022"}
        </button>
      </div>

      {/* offers */}
      <section className="mt-12">
        {data.mode === "demo" ? (
          <>
            <h2 className="text-xl font-semibold tracking-tight">
              The shelf on {data.date}
            </h2>
            <p className="mt-1 max-w-lg text-sm leading-relaxed text-muted">
              ETH had fallen 51% in a month. These are the 30-day offers Monsoon would have priced, from that day&apos;s data.
            </p>
            <div className="mt-6 grid gap-4 md:grid-cols-3">
              {data.offers.map((o, i) => (
                <OfferCard key={i} offer={o} index={i} />
              ))}
            </div>
          </>
        ) : open ? (
          <LiveOpenShelf offers={data.offers} />
        ) : (
          <LiveClosedShelf monthly={data.offers.monthlyRfq} spreads={data.offers.putSpreads} />
        )}
      </section>
    </div>
  );
}

function LiveOpenShelf({ offers }: { offers: Extract<ShelfResponse, { mode: "live" }>["offers"] }) {
  const all: OfferView[] = [...offers.monthlyRfq.map(monthlyToOffer), ...offers.putSpreads];
  const [picked, setPicked] = useState<OfferView | null>(null);
  const defaultM = offers.monthlyRfq[0];
  const strike = picked?.strikes[0] ?? defaultM?.strike;
  const premium = picked?.premiumPerContract ?? defaultM?.estSellerPremium;
  return (
    <>
      <h2 className="text-xl font-semibold tracking-tight">Open offers</h2>
      <p className="mt-1 max-w-lg text-sm leading-relaxed text-muted">
        Live market-maker demand on Thetanuts. Pick a strike you would be happy to own ETH at.
      </p>
      <div className="mt-6 grid gap-4 md:grid-cols-3">
        {all.slice(0, 9).map((o, i) => (
          <OfferCard key={i} offer={o} index={i} onSelect={o.source === "rfq" ? setPicked : undefined} />
        ))}
      </div>
      {strike != null && premium != null && (
        <div className="mt-8 max-w-xl">
          <RfqUnderwrite
            key={strike}
            defaultStrike={strike}
            suggestedPremium={premium}
          />
        </div>
      )}
    </>
  );
}

function LiveClosedShelf({
  monthly,
  spreads,
}: {
  monthly: MonthlyIndicationView[];
  spreads: OfferView[];
}) {
  return (
    <div className="grid gap-12 lg:grid-cols-2">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">What the market pays today</h2>
        <p className="mt-1 text-sm leading-relaxed text-muted">
          Live 30-day quotes from Thetanuts market makers. Monsoon is not selling at these
          conditions, and this table is why the discipline matters.
        </p>
        <div className="mt-5 overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-sm">
            <thead className="bg-surface text-left text-faint">
              <tr>
                <th className="px-4 py-2.5 font-normal">Strike</th>
                <th className="px-4 py-2.5 text-right font-normal">Premium</th>
                <th className="px-4 py-2.5 text-right font-normal">APY</th>
                <th className="px-4 py-2.5 text-right font-normal">Assign odds</th>
              </tr>
            </thead>
            <tbody>
              {monthly.slice(0, 6).map((m) => (
                <tr key={m.strike} className="border-t border-line">
                  <td className="num px-4 py-2.5">${fmtUsd(m.strike)}</td>
                  <td className="num px-4 py-2.5 text-right">${m.estSellerPremium.toFixed(2)}</td>
                  <td className="num px-4 py-2.5 text-right">{(m.apy * 100).toFixed(1)}%</td>
                  <td className="num px-4 py-2.5 text-right">
                    {m.assignProb != null ? `${(m.assignProb * 100).toFixed(0)}%` : "n/a"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {monthly.length > 0 && (
          <div className="mt-5">
            <RfqUnderwrite
              defaultStrike={monthly[0].strike}
              suggestedPremium={monthly[0].estSellerPremium}
            />
          </div>
        )}
      </div>
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Meanwhile, the reserve works</h2>
        <p className="mt-1 text-sm leading-relaxed text-muted">
          In our five-year backtest, the float produced most of the calm-period return, exactly
          like a real insurer.
        </p>
        <div className="mt-5">
          <ReservePanel />
        </div>
        {(() => {
          const longSpreads = spreads.filter((s) => s.dte >= 7).sort((a, b) => b.dte - a.dte);
          if (!longSpreads.length) return null;
          return (
            <>
              <p className="mt-6 text-sm font-medium text-foreground">
                For defined-risk underwriters, these capped-loss spreads are live now:
              </p>
              <div className="mt-4 grid gap-4">
                {longSpreads.slice(0, 2).map((o, i) => (
                  <OfferCard key={i} offer={o} index={i} />
                ))}
              </div>
            </>
          );
        })()}
      </div>
    </div>
  );
}

function monthlyToOffer(m: MonthlyIndicationView): OfferView {
  return {
    kind: "put",
    source: "rfq",
    dte: m.dte,
    strikes: [m.strike],
    premiumPerContract: m.estSellerPremium,
    collateralPerContract: m.strike,
    cycleYield: m.cycleYield,
    apy: m.apy,
    assignProb: m.assignProb,
    iv: m.iv,
  };
}

function ShelfSkeleton() {
  return (
    <div className="mx-auto max-w-6xl animate-pulse px-4 pb-20 pt-16">
      <div className="h-4 w-40 rounded bg-surface-raised" />
      <div className="mt-4 h-12 w-2/3 rounded bg-surface-raised" />
      <div className="mt-4 h-4 w-1/3 rounded bg-surface-raised" />
      <div className="mt-12 grid gap-3 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-28 rounded-lg bg-surface" />
        ))}
      </div>
      <div className="mt-12 grid gap-4 md:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-72 rounded-lg bg-surface" />
        ))}
      </div>
    </div>
  );
}
