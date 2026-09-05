"use client";

// Atmospheric layer behind the shelf hero. Calm: soft drifting light.
// Storm: rain streaks and an occasional distant flash. Decorative only -
// pointer-events-none, behind the text, static under prefers-reduced-motion.
import { useRef } from "react";
import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(useGSAP);

const RAIN_COUNT = 22;

export function WeatherBackdrop({ storm }: { storm: boolean }) {
  const ref = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        return;
      }
      if (storm) {
        gsap.utils.toArray<HTMLElement>(".rain").forEach((el, i) => {
          gsap.fromTo(
            el,
            { yPercent: -120, opacity: 0 },
            {
              yPercent: 260,
              opacity: 0.7,
              duration: gsap.utils.random(1.1, 1.9),
              ease: "none",
              repeat: -1,
              delay: (i % 11) * 0.17 + gsap.utils.random(0, 0.4),
            },
          );
        });
        gsap.to(".flash", {
          opacity: 0.16,
          duration: 0.18,
          yoyo: true,
          repeat: -1,
          repeatDelay: 7.5,
          ease: "power4.in",
        });
      } else {
        gsap.utils.toArray<HTMLElement>(".drift").forEach((el, i) => {
          gsap.to(el, {
            xPercent: i % 2 ? -14 : 14,
            yPercent: i % 2 ? 8 : -8,
            duration: 45 + i * 12,
            yoyo: true,
            repeat: -1,
            ease: "sine.inOut",
          });
        });
      }
    },
    { scope: ref, dependencies: [storm], revertOnUpdate: true },
  );

  return (
    <div
      ref={ref}
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-hidden [mask-image:linear-gradient(to_bottom,black_40%,transparent_95%)]"
    >
      {storm ? (
        <>
          <div className="absolute inset-0 bg-gradient-to-b from-accent/10 via-accent/5 to-transparent" />
          <div className="flash absolute inset-0 bg-accent opacity-0" />
          {Array.from({ length: RAIN_COUNT }, (_, i) => (
            <span
              key={i}
              className="rain absolute top-0 h-10 w-px rounded-full bg-accent/50"
              style={{ left: `${(i * 100) / RAIN_COUNT + 1.5}%`, opacity: 0 }}
            />
          ))}
        </>
      ) : (
        <>
          <div className="drift absolute -top-24 left-[8%] h-64 w-64 rounded-full bg-accent/10 blur-3xl" />
          <div className="drift absolute -top-10 right-[12%] h-72 w-72 rounded-full bg-accent/5 blur-3xl" />
          <div className="drift absolute top-16 left-[45%] h-48 w-48 rounded-full bg-accent/5 blur-3xl" />
        </>
      )}
    </div>
  );
}
