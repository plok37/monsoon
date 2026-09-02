"use client";

import { motion, useReducedMotion } from "motion/react";
import type { OfferView } from "@/lib/types";

const fmtUsd = (n: number, dp = 2) =>
  n.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
const pct = (n: number, dp = 1) => `${(n * 100).toFixed(dp)}%`;

export function OfferCard({
  offer,
  index,
  onSelect,
}: {
  offer: OfferView;
  index: number;
  onSelect?: (offer: OfferView) => void;
}) {
  const reduce = useReducedMotion();
  const isSpread = offer.kind === "putSpread";
  const strikeLabel = isSpread
    ? `$${fmtUsd(offer.strikes[0], 0)} / $${fmtUsd(offer.strikes[1], 0)}`
    : `$${fmtUsd(offer.strikes[0], 0)}`;

  return (
    <motion.article
      initial={reduce ? false : { opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.3 }}
      transition={{ duration: 0.5, delay: index * 0.06, ease: [0.16, 1, 0.3, 1] }}
      className="flex flex-col rounded-lg border border-line bg-surface p-5"
    >
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium text-muted">
          {isSpread ? "Defined-risk put spread" : "Cash-secured put"}
        </h3>
        <span className="rounded bg-surface-raised px-2 py-0.5 text-xs text-faint">
          {offer.source === "simulated" ? "Simulated" : offer.source === "book" ? "Fill now" : "30d RFQ"}
        </span>
      </div>

      <p className="num mt-3 text-3xl font-semibold tracking-tight text-accent">
        {pct(offer.apy)} <span className="text-base font-normal text-muted">APY</span>
      </p>
      <p className="mt-1 text-sm text-muted">
        {pct(offer.cycleYield, 2)} over {offer.dte.toFixed(0)} days
      </p>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-line pt-4 text-sm">
        <dt className="text-faint">Strike</dt>
        <dd className="num text-right">{strikeLabel}</dd>
        <dt className="text-faint">Premium / contract</dt>
        <dd className="num text-right">${fmtUsd(offer.premiumPerContract)}</dd>
        <dt className="text-faint">Locked / contract</dt>
        <dd className="num text-right">${fmtUsd(offer.collateralPerContract, 0)}</dd>
        {offer.assignProb != null && (
          <>
            <dt className="text-faint">Assignment odds</dt>
            <dd className="num text-right">{pct(offer.assignProb)}</dd>
          </>
        )}
      </dl>

      <p className="mt-3 text-sm leading-relaxed text-muted">
        {isSpread
          ? `Max loss is capped at $${fmtUsd(offer.collateralPerContract - offer.premiumPerContract)} per contract.`
          : `Worst case: you buy ETH at $${fmtUsd(offer.strikes[0], 0)} and keep the premium.`}
      </p>

      <button
        onClick={() => onSelect?.(offer)}
        disabled={!onSelect}
        className="mt-4 rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-ink transition-transform hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
      >
        {onSelect ? "Underwrite" : "Simulated offer"}
      </button>
    </motion.article>
  );
}
