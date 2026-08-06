"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "./ui";

type Theme = "light" | "dark" | "system";
const STORAGE_KEY = "myfinance-theme";

function applyTheme(theme: Theme) {
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const dark = theme === "dark" || (theme === "system" && prefersDark);
  document.documentElement.classList.toggle("dark", dark);
}

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const [theme, setTheme] = useState<Theme>("system");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const stored = (localStorage.getItem(STORAGE_KEY) as Theme | null) ?? "system";
    setTheme(stored);
    setMounted(true);

    // Sistem tercihi değişirse "system" modunda anında yansısın.
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if ((localStorage.getItem(STORAGE_KEY) as Theme | null) === "system") {
        applyTheme("system");
      }
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  function pick(next: Theme) {
    setTheme(next);
    localStorage.setItem(STORAGE_KEY, next);
    applyTheme(next);
  }

  const options: Array<{ value: Theme; icon: typeof Sun; label: string }> = [
    { value: "light", icon: Sun, label: "Açık" },
    { value: "dark", icon: Moon, label: "Koyu" },
    { value: "system", icon: Monitor, label: "Sistem" },
  ];

  if (compact) {
    const next: Theme = theme === "dark" ? "light" : "dark";
    const Icon = theme === "dark" ? Sun : Moon;
    return (
      <button
        onClick={() => pick(next)}
        className="focus-ring hover:bg-[var(--surface-2)] flex h-10 w-10 items-center justify-center rounded-lg transition-colors"
        aria-label="Temayı değiştir"
      >
        {mounted ? <Icon size={18} /> : <span className="h-[18px] w-[18px]" />}
      </button>
    );
  }

  return (
    <div className="surface-2 inline-flex rounded-lg p-0.5">
      {options.map(({ value, icon: Icon, label }) => (
        <button
          key={value}
          onClick={() => pick(value)}
          className={cn(
            "focus-ring flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors",
            mounted && theme === value
              ? "bg-[var(--surface)] shadow-sm"
              : "muted hover:text-[var(--text)]",
          )}
          aria-pressed={mounted && theme === value}
        >
          <Icon size={14} />
          {label}
        </button>
      ))}
    </div>
  );
}
