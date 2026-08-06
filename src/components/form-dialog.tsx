"use client";

import { Loader2, Plus, Trash2, X } from "lucide-react";
import {
  useActionState,
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { useFormStatus } from "react-dom";

import type { ActionState } from "@/app/actions/_helpers";
import { Button, cn } from "./ui";

/**
 * Kayıt ekleme/düzenleme kalıbı. Tüm bölümler aynı davranışı paylaşsın diye
 * tek bileşene indirgendi: alt sayfa (mobil) ya da ortada kutu (masaüstü),
 * başarıda kendiliğinden kapanır, hata mesajını form içinde gösterir.
 */

type ServerAction = (prev: ActionState, form: FormData) => Promise<ActionState>;

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" size="lg" className="flex-1" disabled={pending}>
      {pending ? <Loader2 size={16} className="animate-spin" /> : null}
      {pending ? "Kaydediliyor…" : label}
    </Button>
  );
}

export function FormDialog({
  title,
  description,
  action,
  children,
  trigger,
  submitLabel = "Kaydet",
  open: controlledOpen,
  onOpenChange,
  wide = false,
}: {
  title: string;
  description?: string;
  action: ServerAction;
  children: ReactNode;
  trigger?: ReactNode;
  submitLabel?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  wide?: boolean;
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = onOpenChange ?? setUncontrolledOpen;

  const [state, formAction] = useActionState<ActionState, FormData>(action, {});
  const formRef = useRef<HTMLFormElement>(null);
  const titleId = useId();
  const lastHandled = useRef<ActionState | null>(null);

  /* Başarılı kayıtta kapat ve formu sıfırla. */
  useEffect(() => {
    if (state.success && state !== lastHandled.current) {
      lastHandled.current = state;
      setOpen(false);
      formRef.current?.reset();
    }
  }, [state, setOpen]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    // Arka plan kaymasın.
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, setOpen]);

  return (
    <>
      {trigger ? (
        <span onClick={() => setOpen(true)} className="contents">
          {trigger}
        </span>
      ) : null}

      {!open ? null : (
        <>
          <div
            className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px]"
            onClick={() => setOpen(false)}
            aria-hidden
          />

          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className={cn(
              "surface animate-in fixed inset-x-0 bottom-0 z-50 flex max-h-[92dvh] flex-col rounded-t-2xl border-t",
              "sm:inset-x-auto sm:top-1/2 sm:bottom-auto sm:left-1/2 sm:max-h-[85dvh] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:border",
              wide ? "sm:w-[46rem]" : "sm:w-[30rem]",
            )}
          >
            <div className="flex items-start justify-between gap-3 border-b px-4 py-3 sm:px-5">
              <div className="min-w-0">
                <h2 id={titleId} className="truncate text-sm font-semibold">
                  {title}
                </h2>
                {description ? (
                  <p className="muted mt-0.5 text-xs leading-relaxed">{description}</p>
                ) : null}
              </div>
              <button
                onClick={() => setOpen(false)}
                className="focus-ring hover:bg-[var(--surface-2)] flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                aria-label="Kapat"
              >
                <X size={16} />
              </button>
            </div>

            <form ref={formRef} action={formAction} className="flex min-h-0 flex-1 flex-col">
              <div className="thin-scroll min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
                <div className="space-y-3.5">{children}</div>

                {state.error ? (
                  <p
                    role="alert"
                    className="bg-gider/10 text-gider mt-4 rounded-lg px-3 py-2 text-xs leading-relaxed"
                  >
                    {state.error}
                  </p>
                ) : null}
              </div>

              <div
                className="flex gap-2 border-t px-4 py-3 sm:px-5"
                style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 0.75rem)" }}
              >
                <Button
                  type="button"
                  size="lg"
                  onClick={() => setOpen(false)}
                  className="flex-1"
                >
                  Vazgeç
                </Button>
                <SubmitButton label={submitLabel} />
              </div>
            </form>
          </div>
        </>
      )}
    </>
  );
}

/* ───────────────────────────── Silme düğmesi ─────────────────────────────── */

/**
 * Onay isteyen silme düğmesi. İlk tıklama onay ister, ikinci tıklama siler.
 *
 * Kendi `<form>`'unu AÇMAZ: bu düğme çoğu zaman bir düzenleme formunun içinde
 * duruyor ve HTML'de iç içe form geçersizdir — tarayıcı içtekini atar, düğme de
 * dıştaki formu göndermeye başlar. Aksiyon doğrudan çağrılır.
 */
export function DeleteButton({
  action,
  id,
  label = "Sil",
  confirmLabel = "Emin misiniz?",
  className,
  iconOnly = false,
}: {
  action: ServerAction;
  id: number;
  label?: string;
  confirmLabel?: string;
  className?: string;
  iconOnly?: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  /* Onay durumu 4 saniye sonra kendiliğinden geri alınır. */
  useEffect(() => {
    if (!confirming) return;
    const t = setTimeout(() => setConfirming(false), 4000);
    return () => clearTimeout(t);
  }, [confirming]);

  function handleClick() {
    if (!confirming) {
      setConfirming(true);
      return;
    }

    const formData = new FormData();
    formData.set("id", String(id));

    startTransition(async () => {
      const result = await action({}, formData);
      if (result?.error) {
        setError(result.error);
        setConfirming(false);
      }
    });
  }

  return (
    <span className="inline-flex flex-col items-end">
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className={cn(
          "focus-ring inline-flex items-center justify-center gap-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-50",
          iconOnly ? "h-9 w-9" : "h-9 px-2.5",
          confirming
            ? "bg-gider text-white"
            : "muted hover:bg-gider/10 hover:text-gider",
          className,
        )}
        aria-label={confirming ? confirmLabel : label}
      >
        {pending ? (
          <Loader2 size={14} className="animate-spin" />
        ) : (
          <Trash2 size={14} />
        )}
        {iconOnly ? null : confirming ? confirmLabel : label}
      </button>
      {error ? (
        <span className="text-gider mt-1 max-w-48 text-right text-[10px] leading-tight">
          {error}
        </span>
      ) : null}
    </span>
  );
}

/* ────────────────────── Tek tıklamalık aksiyon düğmesi ────────────────────── */

/**
 * Sabit alanlarla bir sunucu aksiyonu çalıştırır (ödendi işaretle, işle vb.).
 * `DeleteButton` ile aynı sebeple form kullanmaz.
 */
export function ActionButton({
  action,
  fields,
  children,
  variant = "secondary",
  size = "sm",
  className,
  title,
}: {
  action: ServerAction;
  fields?: Record<string, string | number>;
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost" | "success";
  size?: "sm" | "md";
  className?: string;
  title?: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleClick() {
    const formData = new FormData();
    for (const [key, value] of Object.entries(fields ?? {})) {
      formData.set(key, String(value));
    }

    setError(null);
    startTransition(async () => {
      const result = await action({}, formData);
      if (result?.error) setError(result.error);
    });
  }

  return (
    <span className="inline-flex flex-col">
      <Button
        type="button"
        onClick={handleClick}
        variant={variant}
        size={size}
        className={className}
        disabled={pending}
        title={title}
      >
        {pending ? <Loader2 size={14} className="animate-spin" /> : children}
      </Button>
      {error ? (
        <span className="text-gider mt-1 text-[10px] leading-tight">{error}</span>
      ) : null}
    </span>
  );
}

/** Yeni kayıt açan standart düğme. */
export function AddButton({ label = "Ekle" }: { label?: string }) {
  return (
    <Button variant="primary" size="sm">
      <Plus size={14} />
      {label}
    </Button>
  );
}
