// Shared API response types (mirror app/api/shelf/route.ts payloads).
import type { GateDecision, MarketSnapshot } from "./engine/gates";

/** A card on the shelf. Two families:
 *  - source "book": instantly BUYABLE protection (you pay the premium)
 *  - source "rfq": seller-side reference for the 30d underwriting auction
 *  - source "simulated": demo-mode underwriting cards from historical data */
export interface OfferView {
  kind: "put" | "putSpread" | "call";
  source: "book" | "simulated" | "rfq";
  dte: number;
  expiry?: number;
  strikes: number[];
  premiumPerContract: number;
  /** rfq/simulated: collateral a seller locks; book: max payout to the buyer */
  collateralPerContract: number;
  cycleYield: number;
  apy: number;
  assignProb: number | null;
  iv: number | null;
  maxContracts?: number;
}

export interface MonthlyIndicationView {
  dte: number;
  strike: number;
  mmAskPerContract: number;
  estSellerPremium: number;
  cycleYield: number;
  apy: number;
  assignProb: number | null;
  iv: number | null;
}

export interface ShelfLive {
  mode: "live";
  forced?: boolean;
  snapshot: MarketSnapshot;
  decision: GateDecision;
  spot: number;
  fetchedAt: number;
  offers: {
    protectionPuts: OfferView[];
    protectionSpreads: OfferView[];
    calls: OfferView[];
    monthlyRfq: MonthlyIndicationView[];
  };
}

export interface ShelfDemo {
  mode: "demo";
  date: string;
  snapshot: MarketSnapshot;
  decision: GateDecision;
  offers: OfferView[];
}

export type ShelfResponse = ShelfLive | ShelfDemo;
