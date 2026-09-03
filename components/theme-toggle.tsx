"use client";

import { useEffect, useState } from "react";
import { SunIcon, MoonStarsIcon } from "@phosphor-icons/react";

export function ThemeToggle() {
  const [theme, setTheme] = useState<"dark" | "light">("light");

  useEffect(() => {
    if (document.documentElement.dataset.theme === "dark") setTheme("dark");
  }, []);

  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    if (next === "dark") {
      document.documentElement.dataset.theme = "dark";
    } else {
      delete document.documentElement.dataset.theme;
    }
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
      {theme === "dark" ? <SunIcon size={16} /> : <MoonStarsIcon size={16} />}
    </button>
  );
}
