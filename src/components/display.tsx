import Link from "next/link";
import type { ReactNode } from "react";

import { formatDateShortTR, relativeDayTR } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { Badge, cn, Panel } from "./ui";

/**
 * Sayı ve tutar gösterimi için ortak bileşenler.
 * Tutarlar her yerde aynı biçimde ve hizalı görünsün diye tek noktadan geçer.
 */

export function Money({
  minor,
  currency = "TRY",
  signed = false,
  tone,
  className,
  compact = false,
}: {
  minor: number;
  currency?: string;
  signed?: boolean;
  /** Belirtilmezse işarete göre otomatik renklenir. */
  tone?: "gelir" | "gider" | "nötr" | "auto";
  className?: string;
  compact?: boolean;
}) {
  const resolved =
    tone === "auto" || tone === undefined
      ? minor > 0
        ? "gelir"
        : minor < 0
          ? "gider"
          : "nötr"
      : tone;

  return (
    <span
      className={cn(
        // `para`: gizli modda bulanıklaştırılacak tutarları işaretler.
        "para tabular whitespace-nowrap",
        signed && resolved === "gelir" && "text-gelir",
        signed && resolved === "gider" && "text-gider",
        className,
      )}
    >
      {formatMoney(minor, currency, { signed, compact })}
    </span>
  );
}

/**
 * Metin içinde geçen tutarları sarmalar: "5 aktif kart · 16.956,27 ₺ borç"
 * gibi karışık cümlelerde yalnızca rakamı gizlemek için.
 */
export function Gizli({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <span className={cn("para", className)}>{children}</span>;
}

/* ─────────────────────────────── Özet kutusu ─────────────────────────────── */

export function StatTile({
  label,
  value,
  sub,
  tone = "nötr",
  href,
  icon,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: "nötr" | "gelir" | "gider" | "uyari" | "brand";
  href?: string;
  icon?: ReactNode;
}) {
  const accent = {
    nötr: "",
    gelir: "text-gelir",
    gider: "text-gider",
    uyari: "text-uyari",
    brand: "text-brand-600 dark:text-brand-300",
  }[tone];

  const body = (
    <>
      <div className="mb-1 flex items-center gap-1.5">
        {icon ? <span className="faint">{icon}</span> : null}
        <span className="faint truncate text-[11px] font-medium tracking-wide uppercase">
          {label}
        </span>
      </div>
      <p className={cn("para tabular text-lg font-semibold sm:text-xl", accent)}>
        {value}
      </p>
      {/* Alt satır neredeyse her zaman tutar içerir; bütünüyle gizlenir. */}
      {sub ? <p className="para muted mt-0.5 truncate text-[11px]">{sub}</p> : null}
    </>
  );

  if (href) {
    return (
      <Link
        href={href}
        className="surface focus-ring block rounded-xl p-3 transition-colors hover:bg-[var(--surface-2)] sm:p-4"
      >
        {body}
      </Link>
    );
  }

  return <Panel className="p-3 sm:p-4">{body}</Panel>;
}

/* ─────────────────────────── Yaklaşan ödeme satırı ───────────────────────── */

export interface ObligationView {
  date: string;
  label: string;
  detail: string;
  amountMinor: number;
  currency: string;
  isIncome: boolean;
  daysUntil: number;
  severity: "bilgi" | "uyari" | "kritik";
  minimumMinor: number | null;
  href?: string;
}

export function ObligationRow({ item }: { item: ObligationView }) {
  const overdue = item.daysUntil < 0;

  const content = (
    <div className="flex items-center gap-3">
      {/* Tarih kutusu — sol kenarda renk şeridi aciliyeti gösterir */}
      <div
        className={cn(
          "flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-lg text-center",
          overdue
            ? "bg-gider/12 text-gider"
            : item.daysUntil <= 3
              ? "bg-uyari/15 text-uyari"
              : "surface-2 muted",
        )}
      >
        <span className="text-sm leading-none font-semibold">
          {item.date.slice(8, 10)}
        </span>
        <span className="mt-0.5 text-[9px] leading-none uppercase">
          {new Date(`${item.date}T00:00:00`).toLocaleDateString("tr-TR", {
            month: "short",
          })}
        </span>
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{item.label}</p>
        <p className="faint truncate text-[11px]">
          {relativeDayTR(item.date)} · {item.detail}
        </p>
      </div>

      <div className="shrink-0 text-right">
        <Money
          minor={item.amountMinor}
          currency={item.currency}
          className={cn(
            "block text-sm font-semibold",
            item.isIncome ? "text-gelir" : undefined,
          )}
        />
        {item.minimumMinor != null && item.minimumMinor > 0 ? (
          <span className="para faint text-[10px]">
            asgari {formatMoney(item.minimumMinor, item.currency)}
          </span>
        ) : overdue ? (
          <Badge tone="gider">gecikmiş</Badge>
        ) : null}
      </div>
    </div>
  );

  return (
    <li className="border-b last:border-b-0">
      {item.href ? (
        <Link
          href={item.href}
          className="focus-ring block px-4 py-2.5 transition-colors hover:bg-[var(--surface-2)] sm:px-5"
        >
          {content}
        </Link>
      ) : (
        <div className="px-4 py-2.5 sm:px-5">{content}</div>
      )}
    </li>
  );
}

/* ─────────────────────────────── Uyarı şeridi ────────────────────────────── */

export function Alert({
  tone = "uyari",
  title,
  children,
  action,
  sensitive = false,
}: {
  tone?: "uyari" | "gider" | "gelir" | "brand";
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  /** Gövde tutar içeriyorsa true — gizli modda bulanıklaştırılır. */
  sensitive?: boolean;
}) {
  const styles = {
    uyari: "bg-uyari/10 text-uyari border-uyari/25",
    gider: "bg-gider/10 text-gider border-gider/25",
    gelir: "bg-gelir/10 text-gelir border-gelir/25",
    brand: "bg-brand-500/10 text-brand-600 dark:text-brand-300 border-brand-500/25",
  }[tone];

  return (
    <div className={cn("rounded-xl border px-4 py-3", styles)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold">{title}</p>
          {children ? (
            <div
              className={cn(
                "mt-0.5 text-xs leading-relaxed opacity-90",
                sensitive && "para",
              )}
            >
              {children}
            </div>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
    </div>
  );
}

/* ─────────────────────────── Hareket listesi satırı ──────────────────────── */

export function TransactionRow({
  date,
  title,
  subtitle,
  amountMinor,
  currency,
  kind,
  color,
  initials,
  action,
}: {
  date: string;
  title: string;
  subtitle: string;
  amountMinor: number;
  currency: string;
  kind: string;
  color: string;
  initials: string;
  action?: ReactNode;
}) {
  const isIncome = kind === "gelir" || kind === "iade";
  const isNeutral = kind === "transfer" || kind === "kart_odeme";

  return (
    <li className="flex items-center gap-3 border-b px-4 py-2.5 last:border-b-0 sm:px-5">
      <span
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white"
        style={{ backgroundColor: color }}
        aria-hidden
      >
        {initials}
      </span>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{title}</p>
        <p className="faint truncate text-[11px]">
          {formatDateShortTR(date)} · {subtitle}
        </p>
      </div>

      <Money
        minor={isIncome ? amountMinor : -amountMinor}
        currency={currency}
        signed={!isNeutral}
        tone={isNeutral ? "nötr" : "auto"}
        className={cn("shrink-0 text-sm font-semibold", isNeutral && "muted")}
      />

      {action ? <div className="shrink-0">{action}</div> : null}
    </li>
  );
}

/** İsim baş harflerinden simge metni üretir. */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toLocaleUpperCase("tr-TR");
  return (words[0][0] + words[1][0]).toLocaleUpperCase("tr-TR");
}
