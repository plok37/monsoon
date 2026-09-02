import backtest from "@/lib/data/backtest.json";
import { EquityChart } from "@/components/evidence/equity-chart";

export const metadata = { title: "Evidence · Monsoon" };

const fmt = (n: number) => `$${Math.round(n / 1000)}k`;
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

export default function EvidencePage() {
  const { curves, summary, meta } = backtest;
  const years = meta.years;
  const apy = (end: number) => ((end / 100_000) ** (1 / years) - 1) * 100;

  const tiles = [
    {
      name: "Monsoon (gated wheel)",
      end: summary.gated.end,
      maxDD: summary.gated.maxDD,
      note: `Sold puts in ${summary.gated.puts} of ${summary.gated.puts + summary.gated.skipped} cycles. Skipping the rest is the strategy.`,
      highlight: true,
    },
    {
      name: "Buy & hold ETH",
      end: summary.hodl.end,
      maxDD: summary.hodl.maxDD,
      note: "The benchmark. Full exposure, full drawdown.",
      highlight: false,
    },
    {
      name: "Naive wheel",
      end: summary.naive.end,
      maxDD: summary.naive.maxDD,
      note: `Collected $${(summary.naive.premium / 1000).toFixed(0)}k premium and still lost money. Premium is not income.`,
      highlight: false,
    },
  ];

  // year-end values from the weekly curve
  const yearEnd = (year: number) => {
    let idx = -1;
    curves.dates.forEach((d: string, i: number) => {
      if (d.startsWith(String(year))) idx = i;
    });
    return idx;
  };
  const yearRows = [2021, 2022, 2023, 2024, 2025, 2026]
    .map((y) => ({ y, i: yearEnd(y) }))
    .filter((r) => r.i >= 0);

  return (
    <div className="mx-auto max-w-6xl px-4 pb-20 pt-16">
      <h1 className="max-w-2xl text-4xl font-semibold tracking-tighter md:text-5xl">
        Five years of ETH history, three ways to trade it.
      </h1>
      <p className="mt-4 max-w-xl leading-relaxed text-muted">
        Same market, same options pricing, same costs. The only difference is discipline:
        the gated wheel underwrites only when insurance is expensive and the strike is
        historically cheap.
      </p>

      <div className="mt-10 grid gap-4 md:grid-cols-3">
        {tiles.map((t) => (
          <div
            key={t.name}
            className={`rounded-lg border p-5 ${
              t.highlight ? "border-accent-dim bg-surface" : "border-line bg-surface"
            }`}
          >
            <h2 className="text-sm font-medium text-muted">{t.name}</h2>
            <p className={`num mt-2 text-3xl font-semibold tracking-tight ${t.highlight ? "text-accent" : ""}`}>
              {fmt(t.end)}
            </p>
            <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
              <div>
                <dt className="text-faint">APY</dt>
                <dd className="num">{apy(t.end).toFixed(1)}%</dd>
              </div>
              <div>
                <dt className="text-faint">Max drawdown</dt>
                <dd className="num">{pct(t.maxDD)}</dd>
              </div>
            </dl>
            <p className="mt-3 text-sm leading-relaxed text-muted">{t.note}</p>
          </div>
        ))}
      </div>

      <section className="mt-14">
        <h2 className="text-xl font-semibold tracking-tight">Equity curves</h2>
        <div className="mt-5 rounded-lg border border-line bg-surface p-5">
          <EquityChart curves={curves} />
        </div>
      </section>

      <section className="mt-14 grid gap-10 lg:grid-cols-[1fr_1.2fr]">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">2022 is the whole argument</h2>
          <p className="mt-3 leading-relaxed text-muted">
            ETH fell 65% that year. Buy-and-hold ended it at $61k. The naive wheel, selling
            premium every single week, ended at $72k. The gated wheel ended 2022 at
            <span className="num text-foreground"> $114k</span>, up 9%, because it spent the
            top in cash and only started underwriting after the crash, at strikes near
            historic lows.
          </p>
          <p className="mt-3 text-sm leading-relaxed text-faint">
            Method: daily Coinbase ETH-USD closes, Deribit DVOL as implied vol, Black-Scholes
            pricing with a 15% market-maker spread haircut, 30-day cycles, physical settlement.
            Results are robust across delta 0.15 to 0.25, both gate thresholds, and a 25%
            haircut. A backtest is evidence, not a guarantee.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-faint">
              <tr className="border-b border-line">
                <th className="py-2.5 pr-4 font-normal">Year end</th>
                <th className="py-2.5 pr-4 text-right font-normal">Monsoon</th>
                <th className="py-2.5 pr-4 text-right font-normal">Buy &amp; hold</th>
                <th className="py-2.5 text-right font-normal">Naive wheel</th>
              </tr>
            </thead>
            <tbody>
              {yearRows.map(({ y, i }) => (
                <tr key={y} className="border-b border-line last:border-0">
                  <td className="num py-2.5 pr-4">{y}</td>
                  <td className="num py-2.5 pr-4 text-right text-accent">{fmt(curves.gated[i])}</td>
                  <td className="num py-2.5 pr-4 text-right">{fmt(curves.hodl[i])}</td>
                  <td className="num py-2.5 text-right">{fmt(curves.naive[i])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
