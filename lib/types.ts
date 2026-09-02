// Shared API response types (mirror app/api/shelf/route.ts payloads).
import type { GateDecision, MarketSnapshot } from "./engine/gates";

export interface OfferView {
  kind: "put" | "putSpread";
  source: "book" | "simulated" | "rfq";
  dte: number;
  expiry?: number;
  strikes: number[];
  premiumPerContract: number;
  collateralPerContract: number;
  cycleYield: number;
  apy: number;
  assignProb: number | null;
  iv: number | null;
  availableUsdc?: number;
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
  snapshot: MarketSnapshot;
  decision: GateDecision;
  spot: number;
  fetchedAt: number;
  offers: {
    directPuts: OfferView[];
    putSpreads: OfferView[];
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
