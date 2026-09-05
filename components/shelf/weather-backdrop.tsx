"use client";

// Full-bleed sky behind the shelf hero: edge-to-edge, under the (translucent)
// nav, fading out before the gate cards. Calm: drifting clouds and soft light.
// Storm: darker sky, angled rain with randomized lengths and speeds, an
// occasional distant flash. Decorative only - pointer-events-none, tokens only,
// static under prefers-reduced-motion.
import { useMemo, useRef } from "react";
import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(useGSAP);

const RAIN_COUNT = 26;

interface Streak {
  left: number;   // %
  height: number; // px
  duration: number;
  delay: number;
  opacity: number;
}

export function WeatherBackdrop({ storm }: { storm: boolean }) {
  const ref = useRef<HTMLDivElement>(null);

  // randomized once per mount; this component only renders client-side
  const streaks = useMemo<Streak[]>(
    () =>
      Array.from({ length: RAIN_COUNT }, () => ({
        left: Math.random() * 104 - 2,
        height: 24 + Math.random() * 40,
        duration: 0.9 + Math.random() * 1.1,
        delay: Math.random() * 2,
        opacity: 0.35 + Math.random() * 0.45,
      })),
    [],
  );

  useGSAP(
    () => {
      if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        return;
      }
      if (storm) {
        gsap.utils.toArray<HTMLElement>(".rain").forEach((el, i) => {
          const s = streaks[i];
          gsap.fromTo(
            el,
            { yPercent: -150, opacity: 0 },
            {
              yPercent: 900,
              opacity: s.opacity,
              duration: s.duration,
              ease: "none",
              repeat: -1,
              delay: s.delay,
            },
          );
        });
        gsap.to(".flash", {
          opacity: 0.14,
          duration: 0.16,
          yoyo: true,
          repeat: -1,
          repeatDelay: 6.5,
          ease: "power4.in",
        });
        gsap.to(".storm-cloud", {
          xPercent: (i: number) => (i % 2 ? -8 : 8),
          duration: 24,
          yoyo: true,
          repeat: -1,
          ease: "sine.inOut",
        });
      } else {
        gsap.utils.toArray<HTMLElement>(".cloud").forEach((el, i) => {
          gsap.to(el, {
            xPercent: i % 2 ? -22 : 22,
            duration: 28 + i * 9,
            yoyo: true,
            repeat: -1,
            ease: "sine.inOut",
          });
        });
        gsap.to(".sun", {
          opacity: 0.75,
          scale: 1.08,
          duration: 9,
          yoyo: true,
          repeat: -1,
          ease: "sine.inOut",
        });
      }
    },
    { scope: ref, dependencies: [storm], revertOnUpdate: true },
  );

  return (
    <div
      ref={ref}
      aria-hidden
      className="pointer-events-none absolute inset-x-0 top-0 h-[26rem] overflow-hidden [mask-image:linear-gradient(to_bottom,black_55%,transparent)]"
    >
      {storm ? (
        <>
          {/* darker sky: gray veil + teal storm light, token-based for both themes */}
          <div className="absolute inset-0 bg-gradient-to-b from-foreground/15 via-foreground/5 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-b from-accent/15 to-transparent" />
          <div className="storm-cloud absolute -top-24 left-[5%] h-56 w-[45%] rounded-full bg-foreground/10 blur-3xl" />
          <div className="storm-cloud absolute -top-28 right-[8%] h-60 w-[50%] rounded-full bg-foreground/15 blur-3xl" />
          <div className="flash absolute inset-0 bg-accent opacity-0" />
          {/* angled rain */}
          <div className="absolute -inset-x-10 inset-y-0 rotate-[12deg]">
            {streaks.map((s, i) => (
              <span
                key={i}
                className="rain absolute top-0 w-px rounded-full bg-accent"
                style={{ left: `${s.left}%`, height: s.height, opacity: 0 }}
              />
            ))}
          </div>
        </>
      ) : (
        <>
          {/* soft daylight band */}
          <div className="absolute inset-0 bg-gradient-to-b from-accent/10 to-transparent" />
          {/* sun glow, upper right */}
          <div className="sun absolute -top-24 right-[6%] h-80 w-80 rounded-full bg-accent/25 blur-3xl opacity-50" />
          {/* clouds */}
          <div className="cloud absolute top-6 left-[4%] h-24 w-72 rounded-full bg-foreground/10 blur-2xl" />
          <div className="cloud absolute top-24 left-[30%] h-20 w-96 rounded-full bg-foreground/5 blur-2xl" />
          <div className="cloud absolute top-10 right-[18%] h-24 w-80 rounded-full bg-foreground/10 blur-2xl" />
          <div className="cloud absolute top-40 right-[38%] h-16 w-64 rounded-full bg-foreground/5 blur-xl" />
        </>
      )}
    </div>
  );
}
