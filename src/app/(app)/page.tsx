import {
  ArrowRight,
  CalendarClock,
  ChartCandlestick,
  CreditCard,
  ListChecks,
  TrendingDown,
  TrendingUp,
  Wallet,
} from "lucide-react";
import Link from "next/link";

import { InstallmentLoadChart, IncomeExpenseChart } from "@/components/charts";
import {
  Alert,
  initialsOf,
  Money,
  ObligationRow,
  StatTile,
  TransactionRow,
} from "@/components/display";
import {
  Badge,
  EmptyState,
  Panel,
  PanelHeader,
  ProgressBar,
} from "@/components/ui";
import {
  burnRate,
  categoryBreakdown,
  installmentFreeDate,
  installmentLoad,
  monthlyTotals,
  netWorth,
  subscriptionCosts,
} from "@/lib/analytics";
import { categoryPath, loadSnapshot } from "@/lib/data";
import {
  formatDateTR,
  formatMonthTR,
  monthKey,
  relativeDayTR,
} from "@/lib/dates";
import { cashflowProjection, upcomingObligations } from "@/lib/forecast";
import { formatMoney, formatPercent } from "@/lib/money";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const snap = await loadSnapshot();

  const worth = netWorth(snap);
  const months = monthlyTotals(snap, 6);
  const thisMonth = months[months.length - 1];
  const burn = burnRate(snap);
  const loads = installmentLoad(snap, 12);
  const obligations = upcomingObligations(snap, { days: 30 });

  /* Gecikmiş olan yalnızca ÖDEMELERDİR; tarihi geçmiş bir gelir borç değildir. */
  const overdue = obligations.filter((o) => o.daysUntil < 0 && !o.isIncome);
  const lateIncome = obligations.filter((o) => o.daysUntil < 0 && o.isIncome);
  const cashflow = cashflowProjection(snap, 60);
  const categories = categoryBreakdown(snap).slice(0, 6);
  const subs = subscriptionCosts(snap);
  const freeDate = installmentFreeDate(snap);

  const hasData = snap.accounts.length > 0 || snap.cards.length > 0;

  if (!hasData) {
    return <FirstRun />;
  }

  const activeCards = snap.cards
    .filter((c) => c.isActive && c.type !== "banka")
    .map((card) => ({ card, ledger: snap.ledgers.get(card.id)! }))
    .filter((x) => x.ledger)
    .sort((a, b) => b.ledger.totalDebtMinor - a.ledger.totalDebtMinor);

  const recentTx = snap.transactions.slice(0, 8);
  const nextLoad = loads[0];
  const peakLoad = [...loads].sort((a, b) => b.totalMinor - a.totalMinor)[0];

  return (
    <div className="space-y-4">
      {/* Kritik uyarılar */}
      {cashflow.firstNegativeDate ? (
        <Alert
          sensitive
          tone="gider"
          title={`Nakit sıkışması: ${formatDateTR(cashflow.firstNegativeDate)}`}
          action={
            <Link
              href="/takvim"
              className="focus-ring inline-flex items-center gap-1 text-xs font-medium underline underline-offset-2"
            >
              Takvim <ArrowRight size={13} />
            </Link>
          }
        >
          Planlanan ödemelerle bakiyeniz{" "}
          {relativeDayTR(cashflow.firstNegativeDate)} eksiye düşüyor. En düşük
          nokta <strong>{formatMoney(cashflow.minBalanceMinor)}</strong>.
        </Alert>
      ) : null}

      {/* Gecikmiş ödemeler. Gelirler DIŞARIDA bırakılır: tarihi geçmiş bir
          maaş "gecikmiş ödeme" değildir, ödenecek bir şey yoktur. */}
      {overdue.length > 0 ? (
        <Alert
          sensitive
          tone="gider"
          title={`${overdue.length} gecikmiş ödeme`}
        >
          {overdue
            .slice(0, 3)
            .map((o) => `${o.label} (${formatMoney(o.amountMinor, o.currency)})`)
            .join(" · ")}
        </Alert>
      ) : null}

      {/* Tarihi geçmiş ama hesaba düşmemiş gelirler ayrı bir bilgi. */}
      {lateIncome.length > 0 ? (
        <Alert
          sensitive
          tone="brand"
          title={`${lateIncome.length} beklenen gelir henüz görünmüyor`}
        >
          {lateIncome
            .slice(0, 3)
            .map((o) => `${o.label} (${formatMoney(o.amountMinor, o.currency)})`)
            .join(" · ")}
          {" — yattıysa hareket olarak girin, plan buna göre düzelir."}
        </Alert>
      ) : null}

      {/* Özet kutuları */}
      <div className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4">
        <StatTile
          label="Net değer"
          icon={<Wallet size={13} />}
          value={<Money minor={worth.netMinor} tone="nötr" />}
          sub={`${formatMoney(worth.assetMinor, "TRY", { compact: true })} varlık · ${formatMoney(worth.debtMinor, "TRY", { compact: true })} borç`}
          tone={worth.netMinor >= 0 ? "nötr" : "gider"}
          href="/hesaplar"
        />
        <StatTile
          label="Toplam borç"
          icon={<CreditCard size={13} />}
          value={<Money minor={worth.debtMinor} tone="nötr" />}
          sub={`Kart ${formatMoney(worth.cardDebtMinor, "TRY", { compact: true })} · Kredi ${formatMoney(worth.loanDebtMinor, "TRY", { compact: true })}`}
          tone={worth.debtMinor > 0 ? "gider" : "nötr"}
          href="/kartlar"
        />
        <StatTile
          label={`${formatMonthTR(monthKey(snap.ref))} gideri`}
          icon={<TrendingDown size={13} />}
          value={<Money minor={burn.spentSoFarMinor} tone="nötr" />}
          sub={
            burn.vsPreviousRatio != null
              ? `Geçen ayın aynı gününe göre ${burn.vsPreviousRatio > 0 ? "+" : ""}${formatPercent(burn.vsPreviousRatio, 0)}`
              : `Ay sonu tahmini ${formatMoney(burn.projectedMonthEndMinor, "TRY", { compact: true })}`
          }
          tone={
            burn.vsPreviousRatio != null && burn.vsPreviousRatio > 0.15
              ? "uyari"
              : "nötr"
          }
          href="/analiz"
        />
        <StatTile
          label="Bu ay net"
          icon={<TrendingUp size={13} />}
          value={<Money minor={thisMonth?.netMinor ?? 0} signed tone="auto" />}
          sub={
            thisMonth && thisMonth.incomeMinor > 0
              ? `Tasarruf oranı ${formatPercent(thisMonth.savingsRate, 0)}`
              : "Gelir kaydı yok"
          }
          tone={(thisMonth?.netMinor ?? 0) >= 0 ? "gelir" : "gider"}
          href="/analiz"
        />
      </div>

      {/* Yatırım özeti — kalem yoksa hiç gösterilmez */}
      {snap.holdings.length > 0 ? (
        <div className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4">
          <StatTile
            label="Portföy"
            icon={<ChartCandlestick size={13} />}
            value={<Money minor={snap.portfolio.valueTryMinor} tone="nötr" />}
            sub={`${snap.portfolio.items.length} kalem · maliyet ${formatMoney(snap.portfolio.costTryMinor, "TRY", { compact: true })}`}
            href="/yatirim"
          />
          <StatTile
            label="Yatırım kâr/zarar"
            icon={<TrendingUp size={13} />}
            value={<Money minor={snap.portfolio.gainTryMinor} signed tone="auto" />}
            sub={
              snap.portfolio.costTryMinor > 0
                ? formatPercent(snap.portfolio.gainRatio, 1)
                : "maliyet girilmedi"
            }
            tone={snap.portfolio.gainTryMinor >= 0 ? "gelir" : "gider"}
            href="/yatirim"
          />
          <StatTile
            label="Bugün"
            icon={<TrendingDown size={13} />}
            value={
              <Money minor={snap.portfolio.dayChangeTryMinor} signed tone="auto" />
            }
            sub={
              snap.portfolio.dayChangeTryMinor !== 0
                ? formatPercent(snap.portfolio.dayChangeRatio, 2)
                : "değişim bilinmiyor"
            }
            tone={snap.portfolio.dayChangeTryMinor >= 0 ? "gelir" : "gider"}
            href="/yatirim"
          />
          <StatTile
            label="Nakit"
            icon={<Wallet size={13} />}
            value={<Money minor={worth.liquidMinor} tone="nötr" />}
            sub="yatırım hariç, harcanabilir"
            href="/hesaplar"
          />
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Yaklaşan ödemeler */}
        <Panel>
          <PanelHeader
            sensitive
            title="Yaklaşan ödemeler"
            subtitle={`Önümüzdeki 30 gün · toplam ${formatMoney(
              obligations
                .filter((o) => !o.isIncome)
                .reduce((s, o) => s + o.amountMinor, 0),
            )}`}
            action={
              <Link
                href="/takvim"
                className="focus-ring text-brand-600 dark:text-brand-300 inline-flex items-center gap-0.5 text-xs font-medium"
              >
                Tümü <ArrowRight size={12} />
              </Link>
            }
          />
          {obligations.length === 0 ? (
            <EmptyState
              icon={<CalendarClock size={28} />}
              title="Yaklaşan ödeme yok"
              description="Kart ekstreleri, abonelikler ve kredi taksitleri burada listelenir."
            />
          ) : (
            <ul>
              {obligations.slice(0, 7).map((o, i) => (
                <ObligationRow
                  key={`${o.type}-${o.entityId}-${o.date}-${i}`}
                  item={{
                    date: o.date,
                    label: o.label,
                    detail: o.detail,
                    amountMinor: o.amountMinor,
                    currency: o.currency,
                    isIncome: o.isIncome,
                    daysUntil: o.daysUntil,
                    severity: o.severity,
                    minimumMinor: o.minimumMinor,
                    href:
                      o.type === "kart_ekstre"
                        ? `/kartlar/${o.cardId}`
                        : o.type === "abonelik"
                          ? "/abonelikler"
                          : o.type === "kredi_taksit"
                            ? "/krediler"
                            : undefined,
                  }}
                />
              ))}
            </ul>
          )}
        </Panel>

        {/* Kartlar */}
        <Panel>
          <PanelHeader
            sensitive
            title="Kartlar"
            subtitle={`${activeCards.length} aktif kart · ${formatMoney(worth.cardDebtMinor)} borç`}
            action={
              <Link
                href="/kartlar"
                className="focus-ring text-brand-600 dark:text-brand-300 inline-flex items-center gap-0.5 text-xs font-medium"
              >
                Tümü <ArrowRight size={12} />
              </Link>
            }
          />
          {activeCards.length === 0 ? (
            <EmptyState
              icon={<CreditCard size={28} />}
              title="Kart tanımlı değil"
              description="Kredi kartlarınızı, hesap kesim ve son ödeme günleriyle birlikte ekleyin."
              action={
                <Link
                  href="/kartlar"
                  className="bg-brand-600 focus-ring inline-flex h-9 items-center rounded-lg px-3 text-xs font-medium text-white"
                >
                  Kart ekle
                </Link>
              }
            />
          ) : (
            <ul>
              {activeCards.slice(0, 5).map(({ card, ledger }) => (
                <li key={card.id} className="border-b last:border-b-0">
                  <Link
                    href={`/kartlar/${card.id}`}
                    className="focus-ring block px-4 py-3 transition-colors hover:bg-[var(--surface-2)] sm:px-5"
                  >
                    <div className="mb-1.5 flex items-center gap-2.5">
                      <span
                        className="h-8 w-8 shrink-0 rounded-md"
                        style={{ backgroundColor: card.color }}
                        aria-hidden
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {card.name}
                          {card.type === "sanal" ? (
                            <Badge tone="brand" className="ml-1.5">
                              sanal
                            </Badge>
                          ) : null}
                        </p>
                        <p className="faint truncate text-[11px]">
                          {ledger.nextDueDate
                            ? `Son ödeme ${formatDateTR(ledger.nextDueDate)}`
                            : "Ödeme bekleyen ekstre yok"}
                        </p>
                      </div>
                      <div className="text-right">
                        <Money
                          minor={ledger.totalDebtMinor}
                          currency={card.currency}
                          className="block text-sm font-semibold"
                        />
                        <span className="para faint text-[10px]">
                          /{" "}
                          {formatMoney(card.creditLimitMinor, card.currency, {
                            compact: true,
                          })}
                        </span>
                      </div>
                    </div>
                    <ProgressBar
                      ratio={ledger.utilizationRatio}
                      tone={
                        ledger.utilizationRatio > 0.9
                          ? "gider"
                          : ledger.utilizationRatio > 0.7
                            ? "uyari"
                            : "brand"
                      }
                    />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      {/* Taksit yükü */}
      <Panel>
        <PanelHeader
          title="Gelecek 12 ayın taksit yükü"
          subtitle={
            freeDate
              ? `Son taksit ${formatDateTR(freeDate)} · en yoğun ay ${peakLoad && peakLoad.totalMinor > 0 ? formatMonthTR(peakLoad.month) : "—"}`
              : "Devam eden taksitli alışveriş yok"
          }
          action={
            <Link
              href="/taksitler"
              className="focus-ring text-brand-600 dark:text-brand-300 inline-flex items-center gap-0.5 text-xs font-medium"
            >
              Detay <ArrowRight size={12} />
            </Link>
          }
        />
        {loads.every((l) => l.totalMinor === 0) ? (
          <EmptyState
            icon={<ListChecks size={28} />}
            title="Taksitli alışveriş yok"
            description="Devam eden taksitlerinizi girdiğinizde gelecek ayların yükü burada görünür."
            action={
              <Link
                href="/taksitler"
                className="bg-brand-600 focus-ring inline-flex h-9 items-center rounded-lg px-3 text-xs font-medium text-white"
              >
                Taksit ekle
              </Link>
            }
          />
        ) : (
          <div className="p-3 sm:p-4">
            <div className="mb-3 flex flex-wrap gap-4">
              <div>
                <p className="faint text-[11px]">Bu ay</p>
                <p className="tabular text-base font-semibold">
                  {formatMoney(nextLoad?.totalMinor ?? 0)}
                </p>
              </div>
              <div>
                <p className="faint text-[11px]">12 ay toplamı</p>
                <p className="tabular text-base font-semibold">
                  {formatMoney(loads.reduce((s, l) => s + l.totalMinor, 0))}
                </p>
              </div>
              <div>
                <p className="faint text-[11px]">Aktif plan</p>
                <p className="tabular text-base font-semibold">
                  {snap.plans.filter((p) => p.status === "aktif").length}
                </p>
              </div>
            </div>
            <InstallmentLoadChart
              data={loads.map((l) => ({
                month: l.month,
                totalMinor: l.totalMinor,
                byCard: l.byCard,
              }))}
            />
          </div>
        )}
      </Panel>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Gelir gider */}
        <Panel>
          <PanelHeader title="Gelir ve gider" subtitle="Son 6 ay" />
          <div className="p-3 sm:p-4">
            <IncomeExpenseChart
              data={months.map((m) => ({
                month: m.month,
                incomeMinor: m.incomeMinor,
                expenseMinor: m.expenseMinor,
                netMinor: m.netMinor,
              }))}
            />
          </div>
        </Panel>

        {/* Kategori dağılımı */}
        <Panel>
          <PanelHeader
            title="Nereye gitti"
            subtitle={`${formatMonthTR(monthKey(snap.ref))} · en çok harcanan 6 kategori`}
            action={
              <Link
                href="/analiz"
                className="focus-ring text-brand-600 dark:text-brand-300 inline-flex items-center gap-0.5 text-xs font-medium"
              >
                Tümü <ArrowRight size={12} />
              </Link>
            }
          />
          {categories.length === 0 ? (
            <EmptyState title="Bu ay harcama kaydı yok" />
          ) : (
            <ul className="divide-y">
              {categories.map((c) => (
                <li key={c.name} className="px-4 py-2.5 sm:px-5">
                  <div className="mb-1.5 flex items-baseline justify-between gap-3">
                    <span className="truncate text-xs font-medium">
                      {c.name}
                    </span>
                    <span className="tabular shrink-0 text-xs font-semibold">
                      {formatMoney(c.amountMinor)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <ProgressBar
                      ratio={c.ratio}
                      tone="brand"
                      showOverflow={false}
                    />
                    <span className="faint tabular w-9 shrink-0 text-right text-[11px]">
                      %{Math.round(c.ratio * 100)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Son hareketler */}
        <Panel>
          <PanelHeader
            title="Son hareketler"
            action={
              <Link
                href="/hareketler"
                className="focus-ring text-brand-600 dark:text-brand-300 inline-flex items-center gap-0.5 text-xs font-medium"
              >
                Tümü <ArrowRight size={12} />
              </Link>
            }
          />
          {recentTx.length === 0 ? (
            <EmptyState
              title="Henüz hareket yok"
              description="Alt çubuktaki + düğmesiyle ilk harcamanızı ekleyin."
            />
          ) : (
            <ul>
              {recentTx.map((tx) => {
                const category = tx.categoryId
                  ? snap.categoryById.get(tx.categoryId)
                  : undefined;
                const source = tx.cardId
                  ? snap.cardById.get(tx.cardId)
                  : tx.accountId
                    ? snap.accountById.get(tx.accountId)
                    : undefined;
                const title =
                  tx.description ??
                  (tx.merchantId
                    ? snap.merchantById.get(tx.merchantId)?.name
                    : null) ??
                  categoryPath(category, snap.categoryById);

                return (
                  <TransactionRow
                    key={tx.id}
                    date={tx.date}
                    title={title}
                    subtitle={`${source?.name ?? "—"}${category ? ` · ${category.name}` : ""}`}
                    amountMinor={tx.amountMinor}
                    currency={tx.currency}
                    kind={tx.kind}
                    color={category?.color ?? source?.color ?? "#94a3b8"}
                    initials={initialsOf(title)}
                  />
                );
              })}
            </ul>
          )}
        </Panel>

        {/* Abonelikler özeti */}
        <Panel>
          <PanelHeader
            sensitive
            title="Abonelikler"
            subtitle={`${subs.activeCount} aktif · yılda ${formatMoney(subs.yearlyMinor)}`}
            action={
              <Link
                href="/abonelikler"
                className="focus-ring text-brand-600 dark:text-brand-300 inline-flex items-center gap-0.5 text-xs font-medium"
              >
                Tümü <ArrowRight size={12} />
              </Link>
            }
          />
          {subs.items.length === 0 ? (
            <EmptyState
              title="Abonelik tanımlı değil"
              description="Netflix, Spotify, telefon paketi gibi düzenli ödemeleri buraya girin."
              action={
                <Link
                  href="/abonelikler"
                  className="bg-brand-600 focus-ring inline-flex h-9 items-center rounded-lg px-3 text-xs font-medium text-white"
                >
                  Abonelik ekle
                </Link>
              }
            />
          ) : (
            <>
              <div className="border-b px-4 py-3 sm:px-5">
                <p className="faint text-[11px]">Aylık toplam yük</p>
                <p className="tabular text-lg font-semibold">
                  {formatMoney(subs.monthlyEquivalentMinor)}
                </p>
              </div>
              <ul>
                {subs.items.slice(0, 6).map((s) => (
                  <li
                    key={s.id}
                    className="flex items-center gap-3 border-b px-4 py-2.5 last:border-b-0 sm:px-5"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{s.name}</p>
                      <p className="faint truncate text-[11px]">
                        {relativeDayTR(s.nextRenewalDate)} yenilenecek
                      </p>
                    </div>
                    <div className="text-right">
                      <Money
                        minor={s.amountMinor}
                        currency={s.currency}
                        className="block text-sm font-medium"
                      />
                      {s.cycle !== "aylik" ? (
                        <span className="para faint text-[10px]">
                          aylık{" "}
                          {formatMoney(s.monthlyEquivalentMinor, "TRY", {
                            compact: true,
                          })}
                        </span>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Panel>
      </div>
    </div>
  );
}

/* ─────────────────────────── İlk kurulum ekranı ──────────────────────────── */

function FirstRun() {
  const steps = [
    {
      href: "/hesaplar",
      title: "Banka hesaplarınızı girin",
      body: "Vadesiz, birikim ve döviz hesapları. Ek hesap (KMH) limitini de buraya yazın.",
    },
    {
      href: "/kartlar",
      title: "Kredi kartlarınızı ekleyin",
      body: "Hesap kesim ve son ödeme günü, limit ve devreden borç. Sanal kartları ana karta bağlayın.",
    },
    {
      href: "/taksitler",
      title: "Devam eden taksitleri girin",
      body: "Ödenmiş taksit sayısını belirtin; sistem kalan takvimi kendisi kurar.",
    },
    {
      href: "/abonelikler",
      title: "Aboneliklerinizi tanımlayın",
      body: "Yenileme tarihi yaklaşınca bildirim alırsınız.",
    },
    {
      href: "/duzenli",
      title: "Maaş ve sabit giderleri girin",
      body: "Nakit akışı projeksiyonu ve borç kapatma tahmini bunlara dayanır.",
    },
    {
      href: "/ayarlar",
      title: "Bildirimleri açın",
      body: "ntfy, Telegram veya e-posta ile yaklaşan ödeme uyarıları alın.",
    },
  ];

  return (
    <div className="mx-auto max-w-2xl py-6">
      <div className="mb-6 text-center">
        <h1 className="text-xl font-semibold">Kuruluma başlayalım</h1>
        <p className="muted mx-auto mt-1.5 max-w-md text-sm leading-relaxed">
          Sisteme veri altlığını girdikçe panel dolmaya başlar. Sırasıyla
          ilerlemeniz önerilir — her adım bir sonrakinin hesaplamalarını besler.
        </p>
      </div>

      <ol className="space-y-2.5">
        {steps.map((step, i) => (
          <li key={step.href}>
            <Link
              href={step.href}
              className="surface focus-ring flex items-start gap-3 rounded-xl p-4 transition-colors hover:bg-[var(--surface-2)]"
            >
              <span className="bg-brand-500/12 text-brand-600 dark:text-brand-300 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold">
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{step.title}</p>
                <p className="muted mt-0.5 text-xs leading-relaxed">
                  {step.body}
                </p>
              </div>
              <ArrowRight size={16} className="faint mt-1 shrink-0" />
            </Link>
          </li>
        ))}
      </ol>
    </div>
  );
}
