"use client";

import { Check, Loader2, Plus, X, Zap } from "lucide-react";
import { useActionState, useEffect, useRef, useState } from "react";

import { quickAddAction, type QuickAddState } from "@/app/actions/transactions";
import { formatMoney } from "@/lib/money";
import { Badge, Button, cn, Select } from "./ui";

export interface QuickSource {
  value: string; // "kart:3" | "hesap:7"
  label: string;
  sublabel: string;
  color: string;
  isCard: boolean;
}

export interface QuickCategory {
  id: number;
  label: string;
}

/**
 * Hızlı harcama girişi. Tek satır metin yazılır ("250 migros"), tutar ve
 * işyeri otomatik ayrıştırılır. Kaydettikten sonra alan temizlenir ve odak
 * geri gelir; böylece arka arkaya giriş yapmak mümkün olur.
 */
export function QuickAdd({
  sources,
  categories,
  recentMerchants,
  trigger = "fab",
}: {
  sources: QuickSource[];
  categories: QuickCategory[];
  recentMerchants: string[];
  /**
   * Hangi tetikleyici çizilsin. Duyarlı sınıflarla ("hidden lg:inline-flex")
   * gizlemeye güvenilmiyor: Button bileşeninin kendi `inline-flex` sınıfı
   * dışarıdan gelen `hidden` ile çakışıyor ve hangisinin kazanacağı sınıf
   * sırasına değil, üretilen CSS'in sırasına bağlı kalıyor.
   */
  trigger?: "fab" | "button";
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<QuickAddState, FormData>(
    quickAddAction,
    {},
  );

  const inputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [text, setText] = useState("");
  const [source, setSource] = useState(sources[0]?.value ?? "");
  const [categoryId, setCategoryId] = useState("");
  const [log, setLog] = useState<string[]>([]);

  /* Kaydedilen girişi listeye ekle, alanı temizle, odağı koru. */
  useEffect(() => {
    if (state.success && state.preview) {
      const p = state.preview;
      setLog((prev) =>
        [
          `${p.kind === "gelir" ? "+" : "−"}${formatMoney(p.amountMinor)} ${p.merchantName}`,
          ...prev,
        ].slice(0, 5),
      );
      setText("");
      inputRef.current?.focus();
    }
  }, [state]);

  /* Açılınca odaklan; Esc ile kapat. */
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => inputRef.current?.focus(), 60);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  /* Klavye kısayolu: herhangi bir yerde "n" tuşu hızlı girişi açar. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const selectedSource = sources.find((s) => s.value === source);
  const noSources = sources.length === 0;

  return (
    <>
      {trigger === "fab" ? (
        /* Mobilde alt çubuğun ortasında yükseltilmiş yuvarlak düğme */
        <button
          onClick={() => setOpen(true)}
          className="bg-brand-600 hover:bg-brand-700 active:bg-brand-800 focus-ring shadow-brand-600/30 flex size-[3.25rem] -translate-y-3 items-center justify-center rounded-full text-white shadow-lg transition-colors"
          aria-label="Hızlı harcama ekle"
        >
          <Plus size={26} strokeWidth={2.5} />
        </button>
      ) : (
        <Button variant="primary" onClick={() => setOpen(true)}>
          <Zap size={15} />
          Hızlı ekle
          <kbd className="ml-1 rounded bg-white/20 px-1 text-[10px] font-semibold">N</kbd>
        </Button>
      )}

      {!open ? null : (
        <>
          <div
            className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px]"
            onClick={() => setOpen(false)}
            aria-hidden
          />

          <div
            className="surface animate-in fixed inset-x-0 bottom-0 z-50 rounded-t-2xl border-t p-4 sm:inset-x-auto sm:top-24 sm:bottom-auto sm:left-1/2 sm:w-[30rem] sm:-translate-x-1/2 sm:rounded-2xl sm:border"
            style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 1rem)" }}
            role="dialog"
            aria-label="Hızlı harcama girişi"
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <Zap size={15} className="text-brand-500" />
                Hızlı giriş
              </h2>
              <button
                onClick={() => setOpen(false)}
                className="focus-ring hover:bg-[var(--surface-2)] flex h-8 w-8 items-center justify-center rounded-lg"
                aria-label="Kapat"
              >
                <X size={16} />
              </button>
            </div>

            {noSources ? (
              <p className="bg-uyari/10 text-uyari rounded-lg px-3 py-3 text-xs leading-relaxed">
                Önce bir hesap ya da kart tanımlamalısınız. Hesaplar veya Kartlar
                bölümünden ekleyebilirsiniz.
              </p>
            ) : (
              <form ref={formRef} action={formAction} className="space-y-3">
                <input type="hidden" name="source" value={source} />
                <input type="hidden" name="categoryId" value={categoryId} />

                <div className="relative">
                  <input
                    ref={inputRef}
                    name="text"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder="250 migros"
                    autoComplete="off"
                    autoCapitalize="none"
                    enterKeyHint="done"
                    className={cn(
                      "focus-ring h-14 w-full rounded-xl border bg-[var(--surface-2)] px-4 pr-12",
                      "text-lg font-medium placeholder:text-[var(--text-faint)]",
                      "focus:border-brand-500 border-[var(--border)]",
                    )}
                  />
                  <button
                    type="submit"
                    disabled={pending || !text.trim()}
                    className="bg-brand-600 focus-ring absolute top-1/2 right-2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-lg text-white disabled:opacity-40"
                    aria-label="Kaydet"
                  >
                    {pending ? (
                      <Loader2 size={18} className="animate-spin" />
                    ) : (
                      <Check size={18} />
                    )}
                  </button>
                </div>

                {/* Sık kullanılan işyerleri — tek dokunuşla doldurur */}
                {recentMerchants.length > 0 ? (
                  <div className="thin-scroll -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
                    {recentMerchants.map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => {
                          setText((v) => (v.trim() ? `${v.trim()} ${m}` : m));
                          inputRef.current?.focus();
                        }}
                        className="surface-2 hover:bg-[var(--surface-3)] focus-ring shrink-0 rounded-full px-2.5 py-1 text-xs whitespace-nowrap"
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                ) : null}

                <div className="grid grid-cols-2 gap-2">
                  <Select
                    value={source}
                    onChange={(e) => setSource(e.target.value)}
                    aria-label="Ödeme kaynağı"
                  >
                    {sources.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </Select>

                  <Select
                    value={categoryId}
                    onChange={(e) => setCategoryId(e.target.value)}
                    aria-label="Kategori"
                  >
                    <option value="">Kategori: otomatik</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label}
                      </option>
                    ))}
                  </Select>
                </div>

                {selectedSource ? (
                  <p className="faint text-[11px]">{selectedSource.sublabel}</p>
                ) : null}

                {state.error ? (
                  <p className="bg-gider/10 text-gider rounded-lg px-3 py-2 text-xs" role="alert">
                    {state.error}
                  </p>
                ) : null}

                {log.length > 0 ? (
                  <div className="border-t pt-2">
                    <p className="faint mb-1.5 text-[10px] font-semibold tracking-wide uppercase">
                      Bu oturumda eklenenler
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {log.map((entry, i) => (
                        <Badge key={`${entry}-${i}`} tone={i === 0 ? "gelir" : "nötr"}>
                          {i === 0 ? <Check size={11} /> : null}
                          {entry}
                        </Badge>
                      ))}
                    </div>
                  </div>
                ) : null}

                <details className="group">
                  <summary className="faint cursor-pointer list-none text-[11px] select-none">
                    Yazım biçimleri ▾
                  </summary>
                  <ul className="faint mt-1.5 space-y-0.5 text-[11px] leading-relaxed">
                    <li>
                      <code className="text-brand-500">250 migros</code> — 250 TL gider
                    </li>
                    <li>
                      <code className="text-brand-500">+8500 maaş</code> — gelir kaydı
                    </li>
                    <li>
                      <code className="text-brand-500">12000/12 vestel</code> — 12 taksitli
                      alışveriş
                    </li>
                    <li>
                      <code className="text-brand-500">250 migros d-1</code> — dünkü harcama
                    </li>
                  </ul>
                </details>
              </form>
            )}
          </div>
        </>
      )}
    </>
  );
}
