"use client";

import {
  ArrowRightLeft,
  CalendarClock,
  ChartPie,
  CreditCard,
  Ellipsis,
  Landmark,
  LayoutDashboard,
  ListChecks,
  PiggyBank,
  Receipt,
  Repeat,
  Settings,
  Target,
  Wallet,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { cn } from "./ui";

export interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
}

/** Alt çubukta gösterilen birincil bölümler (mobil). */
export const PRIMARY_NAV: NavItem[] = [
  { href: "/", label: "Panel", icon: LayoutDashboard },
  { href: "/hareketler", label: "Hareket", icon: ArrowRightLeft },
  { href: "/kartlar", label: "Kartlar", icon: CreditCard },
  { href: "/analiz", label: "Analiz", icon: ChartPie },
];

/** "Daha fazla" menüsündeki bölümler. */
export const SECONDARY_NAV: NavItem[] = [
  { href: "/hesaplar", label: "Hesaplar", icon: Wallet },
  { href: "/taksitler", label: "Taksitler", icon: ListChecks },
  { href: "/abonelikler", label: "Abonelikler", icon: Repeat },
  { href: "/krediler", label: "Krediler", icon: Landmark },
  { href: "/takvim", label: "Ödeme takvimi", icon: CalendarClock },
  { href: "/butce", label: "Bütçe", icon: Target },
  { href: "/hedefler", label: "Birikim hedefleri", icon: PiggyBank },
  { href: "/duzenli", label: "Düzenli gelir/gider", icon: Receipt },
  { href: "/ayarlar", label: "Ayarlar", icon: Settings },
];

export const ALL_NAV = [...PRIMARY_NAV, ...SECONDARY_NAV];

function useIsActive() {
  const pathname = usePathname();
  return (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);
}

/* ─────────────────────── Masaüstü yan gezinme ─────────────────────── */

export function Sidebar() {
  const isActive = useIsActive();

  return (
    <nav className="flex flex-col gap-0.5 p-3">
      {PRIMARY_NAV.map((item) => (
        <SidebarLink key={item.href} item={item} active={isActive(item.href)} />
      ))}

      <div className="my-2 border-t" />

      {SECONDARY_NAV.map((item) => (
        <SidebarLink key={item.href} item={item} active={isActive(item.href)} />
      ))}
    </nav>
  );
}

function SidebarLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      className={cn(
        "focus-ring flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
        active
          ? "bg-brand-500/12 text-brand-600 dark:text-brand-300"
          : "muted hover:bg-[var(--surface-2)] hover:text-[var(--text)]",
      )}
      aria-current={active ? "page" : undefined}
    >
      <Icon size={17} strokeWidth={active ? 2.4 : 2} />
      {item.label}
    </Link>
  );
}

/* ────────────────────────── Mobil alt çubuk ────────────────────────── */

export function BottomNav({ quickAdd }: { quickAdd: React.ReactNode }) {
  const isActive = useIsActive();
  const [moreOpen, setMoreOpen] = useState(false);
  const pathname = usePathname();

  // Sayfa değişince menü kapansın.
  useEffect(() => setMoreOpen(false), [pathname]);

  const moreActive = SECONDARY_NAV.some((i) => isActive(i.href));

  return (
    <>
      {moreOpen ? (
        <div
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
          onClick={() => setMoreOpen(false)}
          aria-hidden
        />
      ) : null}

      {/* Daha fazla menüsü */}
      <div
        className={cn(
          "surface fixed inset-x-0 bottom-0 z-50 rounded-t-2xl border-t transition-transform duration-200 lg:hidden",
          moreOpen ? "translate-y-0" : "pointer-events-none translate-y-full",
        )}
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 0.5rem)" }}
        role="dialog"
        aria-label="Diğer bölümler"
        aria-hidden={!moreOpen}
      >
        <div className="flex items-center justify-between px-4 py-3">
          <h2 className="text-sm font-semibold">Tüm bölümler</h2>
          <button
            onClick={() => setMoreOpen(false)}
            className="focus-ring hover:bg-[var(--surface-2)] flex h-9 w-9 items-center justify-center rounded-lg"
            aria-label="Kapat"
          >
            <X size={18} />
          </button>
        </div>
        <div className="grid grid-cols-3 gap-1 px-3 pb-3">
          {SECONDARY_NAV.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "focus-ring flex flex-col items-center gap-1.5 rounded-xl px-2 py-3 text-center text-[11px] leading-tight font-medium transition-colors",
                  active
                    ? "bg-brand-500/12 text-brand-600 dark:text-brand-300"
                    : "muted hover:bg-[var(--surface-2)]",
                )}
              >
                <Icon size={20} />
                {item.label}
              </Link>
            );
          })}
        </div>
      </div>

      {/* Alt çubuk */}
      <nav
        className="surface fixed inset-x-0 bottom-0 z-30 border-t lg:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        aria-label="Ana gezinme"
      >
        <div className="grid grid-cols-5 items-end">
          {PRIMARY_NAV.slice(0, 2).map((item) => (
            <BottomLink key={item.href} item={item} active={isActive(item.href)} />
          ))}

          {/* Ortadaki hızlı ekleme düğmesi */}
          <div className="flex items-start justify-center pt-1">{quickAdd}</div>

          {PRIMARY_NAV.slice(2).map((item) => (
            <BottomLink key={item.href} item={item} active={isActive(item.href)} />
          ))}
        </div>

        <button
          onClick={() => setMoreOpen((v) => !v)}
          className={cn(
            "focus-ring absolute top-1.5 right-1 flex h-7 w-7 items-center justify-center rounded-md text-[10px]",
            moreActive ? "text-brand-600 dark:text-brand-300" : "faint",
          )}
          aria-label="Diğer bölümler"
          aria-expanded={moreOpen}
        >
          <Ellipsis size={16} />
        </button>
      </nav>
    </>
  );
}

function BottomLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      className={cn(
        "focus-ring flex min-h-14 flex-col items-center justify-center gap-1 text-[10px] font-medium transition-colors",
        active ? "text-brand-600 dark:text-brand-300" : "faint",
      )}
      aria-current={active ? "page" : undefined}
    >
      <Icon size={20} strokeWidth={active ? 2.5 : 2} />
      {item.label}
    </Link>
  );
}

/** Masaüstü üst başlıkta gösterilen sayfa adı. */
export function PageTitle() {
  const pathname = usePathname();
  const match =
    ALL_NAV.find((i) => i.href !== "/" && pathname.startsWith(i.href)) ??
    (pathname === "/" ? PRIMARY_NAV[0] : undefined);
  return <span className="text-sm font-semibold">{match?.label ?? "MyFinance"}</span>;
}
