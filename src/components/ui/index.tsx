import clsx from "clsx";
import type { ComponentProps, ReactNode } from "react";

/**
 * Sade bileşen kiti. Harici UI kütüphanesi yerine elle yazıldı;
 * hepsi sunucu bileşeni olarak çalışabilir ve mobilde dokunma hedefleri
 * en az 44px yüksekliğindedir.
 */

export const cn = clsx;

/* ─────────────────────────────────── Kart ─────────────────────────────────── */

export function Panel({
  className,
  children,
  ...props
}: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "surface rounded-xl shadow-sm shadow-slate-900/[0.03]",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function PanelHeader({
  title,
  subtitle,
  action,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-start justify-between gap-3 border-b px-4 py-3 sm:px-5",
        className,
      )}
    >
      <div className="min-w-0">
        <h2 className="truncate text-sm font-semibold">{title}</h2>
        {subtitle ? (
          <p className="muted mt-0.5 truncate text-xs">{subtitle}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

/* ────────────────────────────────── Düğme ─────────────────────────────────── */

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "success";
type ButtonSize = "sm" | "md" | "lg" | "icon";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-800 shadow-sm",
  secondary:
    "surface hover:bg-[var(--surface-2)] active:bg-[var(--surface-3)]",
  ghost: "hover:bg-[var(--surface-2)] active:bg-[var(--surface-3)]",
  danger: "bg-gider text-white hover:brightness-95 active:brightness-90",
  success: "bg-gelir text-white hover:brightness-95 active:brightness-90",
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: "h-8 px-2.5 text-xs gap-1.5",
  md: "h-11 px-4 text-sm gap-2 sm:h-9",
  lg: "h-12 px-5 text-base gap-2",
  icon: "h-11 w-11 sm:h-9 sm:w-9",
};

export function Button({
  variant = "secondary",
  size = "md",
  className,
  ...props
}: ComponentProps<"button"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  return (
    <button
      className={cn(
        "focus-ring inline-flex select-none items-center justify-center rounded-lg font-medium transition-colors",
        "disabled:pointer-events-none disabled:opacity-50",
        BUTTON_VARIANTS[variant],
        BUTTON_SIZES[size],
        className,
      )}
      {...props}
    />
  );
}

/* ────────────────────────────────── Girdiler ──────────────────────────────── */

const FIELD_BASE =
  "focus-ring w-full rounded-lg border bg-[var(--surface)] px-3 text-[var(--text)] " +
  "placeholder:text-[var(--text-faint)] disabled:opacity-60 transition-colors " +
  "border-[var(--border)] focus:border-brand-500";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(FIELD_BASE, "h-11 sm:h-10", className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return (
    <textarea className={cn(FIELD_BASE, "min-h-24 py-2.5", className)} {...props} />
  );
}

export function Select({ className, children, ...props }: ComponentProps<"select">) {
  return (
    <select
      className={cn(
        FIELD_BASE,
        "h-11 appearance-none pr-9 sm:h-10",
        "bg-[image:var(--chevron)] bg-[length:16px] bg-[position:right_0.65rem_center] bg-no-repeat",
        className,
      )}
      style={{
        // Ok simgesi tema rengine uyum sağlasın diye satır içi data URI.
        ["--chevron" as string]:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")",
      }}
      {...props}
    >
      {children}
    </select>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
  className,
  required,
}: {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
  className?: string;
  required?: boolean;
}) {
  return (
    <label className={cn("block", className)}>
      {label ? (
        <span className="mb-1.5 block text-xs font-medium">
          {label}
          {required ? <span className="text-gider"> *</span> : null}
        </span>
      ) : null}
      {children}
      {error ? (
        <span className="text-gider mt-1 block text-xs">{error}</span>
      ) : hint ? (
        <span className="faint mt-1 block text-xs">{hint}</span>
      ) : null}
    </label>
  );
}

/* ─────────────────────────────────── Rozet ────────────────────────────────── */

type BadgeTone = "nötr" | "gelir" | "gider" | "uyari" | "brand" | "borc";

const BADGE_TONES: Record<BadgeTone, string> = {
  nötr: "bg-[var(--surface-2)] text-[var(--text-muted)]",
  gelir: "bg-gelir/12 text-gelir",
  gider: "bg-gider/12 text-gider",
  uyari: "bg-uyari/15 text-uyari",
  brand: "bg-brand-500/12 text-brand-600 dark:text-brand-300",
  borc: "bg-borc/12 text-borc",
};

export function Badge({
  tone = "nötr",
  className,
  children,
}: {
  tone?: BadgeTone;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap",
        BADGE_TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/* ──────────────────────────────── Boş durum ───────────────────────────────── */

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      {icon ? <div className="faint mb-3">{icon}</div> : null}
      <p className="text-sm font-medium">{title}</p>
      {description ? (
        <p className="muted mt-1 max-w-sm text-xs leading-relaxed">{description}</p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

/* ─────────────────────────────── İlerleme çubuğu ──────────────────────────── */

export function ProgressBar({
  ratio,
  tone = "brand",
  className,
  showOverflow = true,
}: {
  ratio: number;
  tone?: "brand" | "gelir" | "gider" | "uyari";
  className?: string;
  showOverflow?: boolean;
}) {
  const clamped = Math.max(0, Math.min(1, ratio));
  const isOver = showOverflow && ratio > 1;
  const colors = {
    brand: "bg-brand-500",
    gelir: "bg-gelir",
    gider: "bg-gider",
    uyari: "bg-uyari",
  };

  return (
    <div
      className={cn(
        "h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-3)]",
        className,
      )}
      role="progressbar"
      aria-valuenow={Math.round(ratio * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={cn(
          "h-full rounded-full transition-all",
          isOver ? "bg-gider" : colors[tone],
        )}
        style={{ width: `${clamped * 100}%` }}
      />
    </div>
  );
}

/* ─────────────────────────────── Bölüm başlığı ────────────────────────────── */

export function SectionTitle({
  children,
  action,
  className,
}: {
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-2 flex items-center justify-between gap-2", className)}>
      <h2 className="faint text-xs font-semibold tracking-wide uppercase">
        {children}
      </h2>
      {action}
    </div>
  );
}

/* ──────────────────────────────── Ayraç / satır ───────────────────────────── */

export function Row({
  className,
  children,
  ...props
}: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 border-b px-4 py-3 last:border-b-0 sm:px-5",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

/** Renkli yuvarlak simge kutusu — hesap/kart/kategori satırlarında kullanılır. */
export function Dot({
  color,
  children,
  size = "md",
}: {
  color: string;
  children?: ReactNode;
  size?: "sm" | "md";
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full text-white",
        size === "sm" ? "h-6 w-6 text-[10px]" : "h-9 w-9 text-xs font-semibold",
      )}
      style={{ backgroundColor: color }}
      aria-hidden
    >
      {children}
    </span>
  );
}
