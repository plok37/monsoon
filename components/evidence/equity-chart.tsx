"use client";

// Equity-curve line chart: HODL vs naive wheel vs gated wheel (Monsoon).
// Inline SVG. Series colors validated for both surfaces; text wears ink tokens.
import { useMemo, useRef, useState } from "react";

interface Curves {
  dates: string[];
  hodl: number[];
  naive: number[];
  gated: number[];
}

const SERIES = [
  { key: "gated", label: "Monsoon (gated wheel)", color: "var(--series-gated)" },
  { key: "hodl", label: "Buy & hold ETH", color: "var(--series-hodl)" },
  { key: "naive", label: "Naive wheel", color: "var(--series-naive)" },
] as const;

const W = 920;
const H = 380;
const PAD = { top: 16, right: 128, bottom: 28, left: 56 };

export function EquityChart({ curves }: { curves: Curves }) {
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const { xs, yOf, yTicks, yearTicks, paths } = useMemo(() => {
    const n = curves.dates.length;
    const all = [...curves.hodl, ...curves.naive, ...curves.gated];
    const yMin = Math.min(...all) * 0.95;
    const yMax = Math.max(...all) * 1.03;
    const plotW = W - PAD.left - PAD.right;
    const plotH = H - PAD.top - PAD.bottom;
    const xs = curves.dates.map((_, i) => PAD.left + (i / (n - 1)) * plotW);
    const yOf = (v: number) => PAD.top + (1 - (v - yMin) / (yMax - yMin)) * plotH;
    const yTicks = [50_000, 100_000, 150_000].filter((v) => v > yMin && v < yMax);
    const yearTicks: { x: number; label: string }[] = [];
    let last = "";
    curves.dates.forEach((d, i) => {
      const y = d.slice(0, 4);
      if (y !== last) {
        yearTicks.push({ x: xs[i], label: y });
        last = y;
      }
    });
    const paths = Object.fromEntries(
      SERIES.map((s) => [
        s.key,
        curves[s.key].map((v, i) => `${i === 0 ? "M" : "L"}${xs[i].toFixed(1)},${yOf(v).toFixed(1)}`).join(""),
      ]),
    );
    return { xs, yOf, yTicks, yearTicks, paths };
  }, [curves]);

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    const rect = svgRef.current!.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < xs.length; i++) {
      const d = Math.abs(xs[i] - px);
      if (d < bestD) { bestD = d; best = i; }
    }
    setHover(best);
  }

  const hv = hover != null
    ? { date: curves.dates[hover], x: xs[hover],
        vals: SERIES.map((s) => ({ ...s, v: curves[s.key][hover] })) }
    : null;

  return (
    <figure>
      <div className="relative overflow-x-auto">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          className="min-w-[640px] w-full"
          role="img"
          aria-label="Equity curves 2021 to 2026: Monsoon gated wheel versus buy-and-hold ETH versus naive wheel, each starting from 100 thousand dollars"
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
        >
          {/* recessive grid + axis labels */}
          {yTicks.map((v) => (
            <g key={v}>
              <line x1={PAD.left} x2={W - PAD.right} y1={yOf(v)} y2={yOf(v)}
                stroke="var(--line)" strokeWidth="1" />
              <text x={PAD.left - 8} y={yOf(v) + 4} textAnchor="end"
                className="num" fontSize="11" fill="var(--faint)">
                ${v / 1000}k
              </text>
            </g>
          ))}
          {yearTicks.map((t) => (
            <text key={t.label} x={t.x} y={H - 8} fontSize="11"
              className="num" fill="var(--faint)">{t.label}</text>
          ))}

          {SERIES.map((s) => (
            <path key={s.key} d={paths[s.key]} fill="none" stroke={s.color} strokeWidth="2" />
          ))}

          {/* direct labels at line ends */}
          {SERIES.map((s) => {
            const v = curves[s.key][curves[s.key].length - 1];
            return (
              <text key={s.key} x={W - PAD.right + 8} y={yOf(v) + 4} fontSize="12"
                fill="var(--foreground)">
                <tspan className="num">${Math.round(v / 1000)}k</tspan>
                <tspan fill="var(--muted)"> {s.key === "gated" ? "Monsoon" : s.key === "hodl" ? "HODL" : "naive"}</tspan>
              </text>
            );
          })}

          {/* crosshair */}
          {hv && (
            <line x1={hv.x} x2={hv.x} y1={PAD.top} y2={H - PAD.bottom}
              stroke="var(--faint)" strokeWidth="1" strokeDasharray="3 3" />
          )}
          {hv && hv.vals.map((s) => (
            <circle key={s.key} cx={hv.x} cy={yOf(s.v)} r="4" fill={s.color}
              stroke="var(--surface)" strokeWidth="2" />
          ))}
        </svg>

        {hv && (
          <div
            className="pointer-events-none absolute top-2 rounded-md border border-line bg-surface px-3 py-2 text-xs shadow-sm"
            style={{ left: `min(max(${(hv.x / W) * 100}% - 60px, 0px), calc(100% - 150px))` }}
          >
            <p className="num text-faint">{hv.date}</p>
            {hv.vals.map((s) => (
              <p key={s.key} className="mt-1 flex items-center gap-2">
                <span className="inline-block h-2 w-2 rounded-full" style={{ background: s.color }} />
                <span className="text-muted">{s.label}</span>
                <span className="num ml-auto pl-3 text-foreground">
                  ${s.v.toLocaleString("en-US")}
                </span>
              </p>
            ))}
          </div>
        )}
      </div>

      <figcaption className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-muted">
        {SERIES.map((s) => (
          <span key={s.key} className="flex items-center gap-2">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
        <span className="text-faint">$100k start, Apr 2021 to Aug 2026</span>
      </figcaption>
    </figure>
  );
}
