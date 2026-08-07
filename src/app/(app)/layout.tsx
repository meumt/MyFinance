import { LogOut } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { logoutAction } from "@/app/actions/auth";
import { BottomNav, PageTitle, Sidebar } from "@/components/nav";
import { QuickAdd, type QuickSource } from "@/components/quick-add";
import { PrivacyToggle } from "@/components/privacy-toggle";
import { ThemeToggle } from "@/components/theme-toggle";
import { getCurrentUser } from "@/lib/auth";
import { flattenCategories } from "@/lib/analytics";
import { loadSnapshot } from "@/lib/data";

/**
 * Uygulama kabuğu. Masaüstünde sol kenar çubuğu, mobilde alt gezinme çubuğu
 * ve ortada yükseltilmiş hızlı ekleme düğmesi gösterilir.
 */
export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const snap = await loadSnapshot();

  /* Hızlı giriş için kaynak listesi: önce kartlar, sonra hesaplar. */
  const sources: QuickSource[] = [
    ...snap.cards
      .filter((c) => c.isActive)
      .map((card) => {
        const ledger = snap.ledgers.get(card.id);
        return {
          value: `kart:${card.id}`,
          label: card.name,
          sublabel: ledger
            ? `Kullanılabilir limit: ${(ledger.availableLimitMinor / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2 })} ${card.currency}`
            : card.currency,
          color: card.color,
          isCard: true,
        };
      }),
    ...snap.accounts
      .filter((a) => a.isActive)
      .map((account) => {
        const balance = snap.balances.get(account.id);
        return {
          value: `hesap:${account.id}`,
          label: account.name,
          sublabel: balance
            ? `Bakiye: ${(balance.balanceMinor / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2 })} ${account.currency}`
            : account.currency,
          color: account.color,
          isCard: false,
        };
      }),
  ];

  const categories = flattenCategories(snap.categories, "gider")
    .filter((c) => c.isActive)
    .map((c) => ({ id: c.id, label: c.label }));

  /* En sık kullanılan işyerleri hızlı giriş çipleri olarak sunulur. */
  const recentMerchants = [...snap.merchants]
    .sort((a, b) => b.usageCount - a.usageCount || (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0))
    .slice(0, 10)
    .map((m) => m.name);

  const quickAddProps = { sources, categories, recentMerchants };

  return (
    <div className="min-h-dvh lg:flex">
      {/* Masaüstü kenar çubuğu */}
      <aside className="surface sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r lg:flex">
        <div className="flex items-center gap-2.5 px-4 py-4">
          <div className="bg-brand-600 flex h-9 w-9 items-center justify-center rounded-xl text-lg font-bold text-white">
            ₺
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">MyFinance</p>
            <p className="faint truncate text-[11px]">
              {user.displayName ?? user.username}
            </p>
          </div>
        </div>

        <div className="thin-scroll flex-1 overflow-y-auto">
          <Sidebar />
        </div>

        <div className="flex items-center justify-between gap-2 border-t p-3">
          <div className="flex items-center gap-0.5">
            <PrivacyToggle compact />
            <ThemeToggle compact />
          </div>
          <form action={logoutAction}>
            <button
              type="submit"
              className="focus-ring muted hover:bg-[var(--surface-2)] flex h-10 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium"
            >
              <LogOut size={15} />
              Çıkış
            </button>
          </form>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobil üst başlık */}
        <header className="surface sticky top-0 z-20 flex h-14 items-center justify-between gap-2 border-b px-4 lg:hidden">
          <Link href="/" className="flex items-center gap-2">
            <div className="bg-brand-600 flex h-7 w-7 items-center justify-center rounded-lg text-sm font-bold text-white">
              ₺
            </div>
            <PageTitle />
          </Link>
          <div className="flex items-center gap-0.5">
            <PrivacyToggle compact />
            <ThemeToggle compact />
            <form action={logoutAction}>
              <button
                type="submit"
                className="focus-ring muted hover:bg-[var(--surface-2)] flex h-10 w-10 items-center justify-center rounded-lg"
                aria-label="Çıkış yap"
              >
                <LogOut size={17} />
              </button>
            </form>
          </div>
        </header>

        {/* Masaüstü üst çubuk */}
        <header className="surface sticky top-0 z-20 hidden h-14 items-center justify-between border-b px-6 lg:flex">
          <PageTitle />
          <QuickAdd {...quickAddProps} trigger="button" />
        </header>

        <main className="mx-auto w-full max-w-6xl flex-1 px-3 py-4 pb-24 sm:px-5 lg:px-6 lg:pb-8">
          {children}
        </main>
      </div>

      <BottomNav quickAdd={<QuickAdd {...quickAddProps} trigger="fab" />} />
    </div>
  );
}
