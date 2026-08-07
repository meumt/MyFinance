"use client";

import { Eye, EyeOff } from "lucide-react";
import { useEffect, useState } from "react";

const STORAGE_KEY = "myfinance-gizli";

/**
 * Tutarları gizler/gösterir. Varsayılan olarak GİZLİDİR: uygulama her
 * açıldığında tutarlar bulanık gelir, göstermek bilinçli bir hareket olur.
 *
 * Tercih sessionStorage'da tutulur — sekme/uygulama kapanınca sıfırlanır.
 * Sınıf `<html>` üzerinde durduğu için gizleme CSS ile yapılır; hiçbir tutar
 * bir an için bile ekrana çıkmaz (bkz. layout.tsx içindeki açılış betiği).
 */
export function PrivacyToggle({ compact = false }: { compact?: boolean }) {
  const [hidden, setHidden] = useState(true);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setHidden(document.documentElement.classList.contains("gizli"));
    setMounted(true);
  }, []);

  function toggle() {
    const next = !hidden;
    setHidden(next);
    document.documentElement.classList.toggle("gizli", next);
    try {
      sessionStorage.setItem(STORAGE_KEY, next ? "acik" : "kapali");
    } catch {
      /* gizli sekmede sessionStorage engellenebilir; sorun değil */
    }
  }

  const Icon = hidden ? EyeOff : Eye;
  const label = hidden ? "Tutarları göster" : "Tutarları gizle";

  return (
    <button
      onClick={toggle}
      className={
        compact
          ? "focus-ring hover:bg-[var(--surface-2)] flex h-10 w-10 items-center justify-center rounded-lg transition-colors"
          : "focus-ring hover:bg-[var(--surface-2)] muted flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium transition-colors"
      }
      aria-label={label}
      aria-pressed={mounted ? hidden : undefined}
      title={label}
    >
      {mounted ? <Icon size={compact ? 18 : 15} /> : <span className="h-[18px] w-[18px]" />}
      {compact ? null : hidden ? "Gizli" : "Görünür"}
    </button>
  );
}
