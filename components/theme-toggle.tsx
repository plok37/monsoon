"use client";

import { useEffect, useState } from "react";
import { Sun, MoonStars } from "@phosphor-icons/react";

export function ThemeToggle() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  useEffect(() => {
    const t = document.documentElement.dataset.theme;
    if (t === "light") setTheme("light");
  }, []);

  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("monsoon-theme", next);
    } catch {}
  }

  return (
    <button
      onClick={toggle}
      aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      className="rounded-md border border-line p-2 text-muted transition-colors hover:text-foreground active:scale-[0.98]"
    >
      {theme === "dark" ? <Sun size={16} /> : <MoonStars size={16} />}
    </button>
  );
}
