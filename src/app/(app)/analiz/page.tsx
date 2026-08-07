import { AlertTriangle, PartyPopper, ShieldCheck, Store } from "lucide-react";
import Link from "next/link";

import {
  CategoryBars,
  IncomeExpenseChart,
  PayoffChart,
} from "@/components/charts";
import { Alert, Money } from "@/components/display";
import {
  Badge,
  EmptyState,
  Panel,
  PanelHeader,
  ProgressBar,
} from "@/components/ui";
import {
  budgetStatus,
  burnRate,
  categoryBreakdown,
  installmentFreeDate,
  monthlyTotals,
  netWorth,
  subscriptionCosts,
  topMerchants,
} from "@/lib/analytics";
import { loadSnapshot } from "@/lib/data";
import { formatDateTR, formatMonthTR, monthKey } from "@/lib/dates";
import { emergencyRunway, payoffProjection } from "@/lib/forecast";
import { formatMoney, formatPercent, parseMoneyToMinor } from "@/lib/money";
import { monthlyOutlook } from "@/lib/outlook";
import { LivingCostForm } from "./living-cost";
import { PayoffControls } from "./payoff-controls";
import { PlanPanel } from "./plan";

export const metadata = { title: "Analiz" };
export const dynamic = "force-dynamic";

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const snap = await loadSnapshot();

  const currentMonth = monthKey(snap.ref);
  const month =
    params.ay && /^\d{4}-\d{2}$/.test(params.ay) ? params.ay : currentMonth;

  const months = monthlyTotals(snap, 12);
  const breakdown = categoryBreakdown(snap, month);
  const merchants = topMerchants(snap, month, 8);
  const burn = burnRate(snap);
  const worth = netWorth(snap);
  const runway = emergencyRunway(snap);
  const subs = subscriptionCosts(snap);
  const budgets = budgetStatus(snap, month);
  const freeDate = installmentFreeDate(snap);

  /* İleriye dönük plan — geçmiş veri gerektirmez, bu yüzden en üstte durur. */
  const outlook = monthlyOutlook(snap, {
    months: 12,
    livingCostMinor: snap.settings.livingCostMinor,
  });

  const withData = months.filter(
    (m) => m.incomeMinor > 0 || m.expenseMinor > 0,
  );
  /* Geçmişe dayanan bölümler veri yokken boş grafikten ibaret kalıyor;
     gösterilmeleri ekranı anlaşılmaz yapıyor. Veri birikince açılırlar. */
  const hasHistory = withData.length > 0;
  const avgSavingsRate = hasHistory
    ? withData.reduce((s, m) => s + m.savingsRate, 0) / withData.length
    : 0;

  /* Borç kapatma simülasyonu — varsayımlar adres çubuğundan gelebilir.
     Geçmiş yoksa ortalamalar sıfır çıkar ve simülasyon "borç kapanmıyor"
     der; oysa maaş ve sabit giderler zaten tanımlı. O durumda plandaki
     tipik bir ay (bu ay değil — kırpılmış olur) varsayım olarak alınır. */
  const typical = outlook.months[1] ?? outlook.months[0];
  const knownIncome = typical?.incomeMinor ?? 0;
  const knownExpense = typical
    ? typical.otherOutflowMinor +
      typical.subscriptionMinor +
      typical.livingCostMinor
    : 0;

  const overrides = {
    monthlyIncomeMinor:
      parseMoneyToMinor(params.gelir ?? "") ??
      (hasHistory ? undefined : knownIncome),
    monthlyExpenseMinor:
      parseMoneyToMinor(params.gider ?? "") ??
      (hasHistory ? undefined : knownExpense),
    extraPaymentMinor: parseMoneyToMinor(params.ek ?? "") ?? undefined,
    strategy: (params.strateji === "kartopu" ? "kartopu" : "cig") as
      | "cig"
      | "kartopu",
  };
  const payoff = payoffProjection(snap, overrides);

  return (
    <div className="space-y-4">
      <PlanPanel outlook={outlook} currentMonth={currentMonth} />

      {/* Yaşam gideri varsayımı girilmişse plan panelinde uyarı çıkmaz;
          değiştirmek isteyen buradan düzeltir. */}
      {outlook.assumedLivingCostMinor > 0 ? (
        <Panel className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <p className="text-xs font-medium">Aylık yaşam gideri varsayımı</p>
            <p className="faint text-[11px]">
              Plandaki her aya bu tutar eklenir. Market, ulaşım, yemek gibi
              bilinen ödemeler dışındaki harcamalar.
            </p>
          </div>
          <LivingCostForm valueMinor={outlook.assumedLivingCostMinor} />
        </Panel>
      ) : null}

      {/* Kaç ayda toparlarım */}
      <Panel id="borc">
        <PanelHeader
          title="Kaç ayda toparlarım?"
          subtitle="Mevcut borçlar, taksitler ve tasarruf kapasitenizle borçtan çıkış simülasyonu"
        />

        <PayoffControls
          incomeMinor={payoff.assumptions.monthlyIncomeMinor}
          expenseMinor={payoff.assumptions.monthlyExpenseMinor}
          extraMinor={payoff.assumptions.extraPaymentMinor}
          strategy={payoff.assumptions.strategy}
          source={hasHistory ? "gecmis" : "plan"}
        />

        {payoff.startingDebtMinor <= 0 ? (
          <EmptyState
            icon={<PartyPopper size={28} />}
            title="Borcunuz yok"
            description="Kredi kartı devreden borcu, taksit ve kredi yükünüz bulunmuyor."
          />
        ) : (
          <>
            <div className="grid grid-cols-2 divide-x border-b sm:grid-cols-4">
              <Cell
                label="Toplam borç"
                value={formatMoney(payoff.startingDebtMinor)}
                tone="gider"
              />
              <Cell
                label="Aylık kapasite"
                value={formatMoney(payoff.monthlyCapacityMinor)}
                tone={payoff.isSustainable ? "gelir" : "gider"}
              />
              <Cell
                label="Borçsuz kalma"
                value={
                  payoff.debtFreeMonth
                    ? formatMonthTR(payoff.debtFreeMonth)
                    : "10 yıl+"
                }
                tone={payoff.debtFreeMonth ? "gelir" : "gider"}
              />
              <Cell
                label="Ödenecek faiz"
                value={formatMoney(payoff.totalInterestMinor)}
                tone="gider"
              />
            </div>

            {!payoff.isSustainable ? (
              <div className="px-4 pt-3.5 sm:px-5">
                <Alert
                  sensitive
                  tone="gider"
                  title="Mevcut tempoda borç kapanmıyor"
                >
                  Aylık geliriniz giderlerinizi karşılamıyor
                  {payoff.monthlyCapacityMinor < 0
                    ? ` (${formatMoney(Math.abs(payoff.monthlyCapacityMinor))} açık)`
                    : ""}
                  . Borcu azaltmak için gider kısmanız ya da gelir artırmanız
                  gerekiyor. Yukarıdaki alanlardan farklı senaryolar
                  deneyebilirsiniz.
                </Alert>
              </div>
            ) : payoff.monthsToDebtFree ? (
              <div className="px-4 pt-3.5 sm:px-5">
                <Alert
                  sensitive
                  tone={payoff.monthsToDebtFree <= 12 ? "gelir" : "brand"}
                  title={`${payoff.monthsToDebtFree} ayda borçsuz kalırsınız`}
                >
                  {payoff.debtFreeMonth
                    ? formatMonthTR(payoff.debtFreeMonth)
                    : ""}{" "}
                  itibarıyla tüm kart borcu, taksit ve krediniz kapanmış olur.
                  Bu süreçte{" "}
                  <strong>{formatMoney(payoff.totalInterestMinor)}</strong> faiz
                  ödersiniz.
                  {payoff.assumptions.extraPaymentMinor === 0
                    ? " Ek ödeme alanına tutar girerek bu süreyi ne kadar kısaltacağınızı görebilirsiniz."
                    : ""}
                </Alert>
              </div>
            ) : null}

            <div className="p-3 sm:p-4">
              <PayoffChart
                data={payoff.months.map((m) => ({
                  month: m.month,
                  debtMinor: m.closingDebtMinor,
                }))}
              />
            </div>

            <div className="table-scroll border-t">
              <table className="w-full min-w-[36rem] text-xs">
                <thead>
                  <tr className="faint border-b text-left">
                    <th className="px-4 py-2 font-medium sm:px-5">Ay</th>
                    <th className="px-2 py-2 text-right font-medium">Taksit</th>
                    <th className="px-2 py-2 text-right font-medium">Kredi</th>
                    <th className="px-2 py-2 text-right font-medium">
                      Kart / KMH
                    </th>
                    <th className="px-2 py-2 text-right font-medium">Faiz</th>
                    <th className="px-4 py-2 text-right font-medium sm:px-5">
                      Kalan borç
                    </th>
                  </tr>
                </thead>
                <tbody className="tabular">
                  {payoff.months.slice(0, 24).map((m) => (
                    <tr key={m.month} className="border-b last:border-b-0">
                      <td className="px-4 py-2 sm:px-5">
                        {formatMonthTR(m.month)}
                        {m.shortfall ? (
                          <Badge tone="gider" className="ml-1.5">
                            yetersiz
                          </Badge>
                        ) : null}
                      </td>
                      <td className="muted px-2 py-2 text-right">
                        {m.installmentsMinor > 0
                          ? formatMoney(m.installmentsMinor, "TRY", {
                              showSymbol: false,
                            })
                          : "—"}
                      </td>
                      <td className="muted px-2 py-2 text-right">
                        {m.loanPaymentsMinor > 0
                          ? formatMoney(m.loanPaymentsMinor, "TRY", {
                              showSymbol: false,
                            })
                          : "—"}
                      </td>
                      <td className="px-2 py-2 text-right">
                        {m.revolvingPaymentMinor > 0
                          ? formatMoney(m.revolvingPaymentMinor, "TRY", {
                              showSymbol: false,
                            })
                          : "—"}
                      </td>
                      <td className="text-gider px-2 py-2 text-right">
                        {m.interestMinor > 0
                          ? formatMoney(m.interestMinor, "TRY", {
                              showSymbol: false,
                            })
                          : "—"}
                      </td>
                      <td className="px-4 py-2 text-right font-semibold sm:px-5">
                        {formatMoney(m.closingDebtMinor, "TRY", {
                          showSymbol: false,
                        })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="faint px-4 py-3 text-[11px] leading-relaxed sm:px-5">
              Simülasyon her ay taksit ve kredi ödemelerini önceliklendirir,
              kalan kapasiteyi{" "}
              {payoff.assumptions.strategy === "cig"
                ? "en yüksek faizli borca"
                : "en küçük bakiyeli borca"}{" "}
              yatırır. Ödenmeyen kart borcuna aylık{" "}
              {formatPercent(snap.settings.cardMonthlyRateBps / 10000, 2)} faiz
              işletilir.
              {freeDate
                ? ` Taksitleriniz ${formatDateTR(freeDate)} tarihinde bitiyor; sonrasında kapasite artar.`
                : ""}
            </p>
          </>
        )}
      </Panel>

      {/* Geçmişe dayalı analizler. Hareket birikmeden bu bölüm boş grafiklerden
          ibaret kaldığı için katlanmış durur ve veri yokken hiç açılmaz. */}
      {!hasHistory ? (
        <Panel className="px-4 py-3.5 sm:px-5">
          <p className="text-xs font-medium">Geçmişe dayalı analizler</p>
          <p className="faint mt-0.5 text-[11px] leading-relaxed">
            Kategori dağılımı, gelir–gider trendi ve tasarruf oranı için en az
            bir aylık hareket geçmişi gerekiyor. Harcamalarını girdikçe bu bölüm
            kendiliğinden açılacak.
          </p>
        </Panel>
      ) : (
        <details className="group space-y-4">
          <summary className="surface focus-ring flex cursor-pointer list-none items-center justify-between rounded-xl px-4 py-3 text-xs font-medium sm:px-5">
            <span>Geçmişe dayalı analizler</span>
            <span className="faint text-[11px] group-open:hidden">göster</span>
            <span className="faint hidden text-[11px] group-open:inline">
              gizle
            </span>
          </summary>

          <div className="mt-4 space-y-4">
            {/* Sağlık göstergeleri */}
            <div className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4">
              <Panel className="p-3 sm:p-4">
                <p className="faint text-[11px] font-medium tracking-wide uppercase">
                  Ortalama tasarruf oranı
                </p>
                <p
                  className={`tabular mt-1 text-lg font-semibold ${avgSavingsRate >= 0.2 ? "text-gelir" : avgSavingsRate < 0 ? "text-gider" : ""}`}
                >
                  {formatPercent(avgSavingsRate, 0)}
                </p>
                <p className="muted mt-0.5 text-[11px]">
                  son {withData.length} ay
                </p>
              </Panel>

              <Panel className="p-3 sm:p-4">
                <p className="faint text-[11px] font-medium tracking-wide uppercase">
                  Acil durum fonu
                </p>
                <p
                  className={`tabular mt-1 text-lg font-semibold ${runway.months >= 3 ? "text-gelir" : runway.months < 1 ? "text-gider" : "text-uyari"}`}
                >
                  {runway.months > 0 ? `${runway.months.toFixed(1)} ay` : "—"}
                </p>
                <p className="para muted mt-0.5 text-[11px]">
                  zorunlu giderle{" "}
                  {formatMoney(runway.monthlyEssentialMinor, "TRY", {
                    compact: true,
                  })}
                  /ay
                </p>
              </Panel>

              <Panel className="p-3 sm:p-4">
                <p className="faint text-[11px] font-medium tracking-wide uppercase">
                  Borç / gelir oranı
                </p>
                <p className="tabular mt-1 text-lg font-semibold">
                  {payoff.assumptions.monthlyIncomeMinor > 0
                    ? formatPercent(
                        worth.debtMinor /
                          (payoff.assumptions.monthlyIncomeMinor * 12),
                        0,
                      )
                    : "—"}
                </p>
                <p className="muted mt-0.5 text-[11px]">yıllık gelire göre</p>
              </Panel>

              <Panel className="p-3 sm:p-4">
                <p className="faint text-[11px] font-medium tracking-wide uppercase">
                  Abonelik yükü
                </p>
                <p className="para tabular mt-1 text-lg font-semibold">
                  {payoff.assumptions.monthlyIncomeMinor > 0
                    ? formatPercent(
                        subs.monthlyEquivalentMinor /
                          payoff.assumptions.monthlyIncomeMinor,
                        1,
                      )
                    : formatMoney(subs.monthlyEquivalentMinor, "TRY", {
                        compact: true,
                      })}
                </p>
                <p className="muted mt-0.5 text-[11px]">aylık gelirin payı</p>
              </Panel>
            </div>

            {/* Gelir gider trendi */}
            <Panel>
              <PanelHeader title="Gelir ve gider" subtitle="Son 12 ay" />
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
              <div className="table-scroll border-t">
                <table className="w-full min-w-[32rem] text-xs">
                  <thead>
                    <tr className="faint border-b text-left">
                      <th className="px-4 py-2 font-medium sm:px-5">Ay</th>
                      <th className="px-2 py-2 text-right font-medium">
                        Gelir
                      </th>
                      <th className="px-2 py-2 text-right font-medium">
                        Gider
                      </th>
                      <th className="px-2 py-2 text-right font-medium">
                        Zorunlu
                      </th>
                      <th className="px-2 py-2 text-right font-medium">Net</th>
                      <th className="px-4 py-2 text-right font-medium sm:px-5">
                        Tasarruf
                      </th>
                    </tr>
                  </thead>
                  <tbody className="tabular">
                    {[...months].reverse().map((m) => (
                      <tr key={m.month} className="border-b last:border-b-0">
                        <td className="px-4 py-2 sm:px-5">
                          {formatMonthTR(m.month)}
                        </td>
                        <td className="text-gelir px-2 py-2 text-right">
                          {formatMoney(m.incomeMinor, "TRY", {
                            showSymbol: false,
                          })}
                        </td>
                        <td className="text-gider px-2 py-2 text-right">
                          {formatMoney(m.expenseMinor, "TRY", {
                            showSymbol: false,
                          })}
                        </td>
                        <td className="muted px-2 py-2 text-right">
                          {formatMoney(m.essentialMinor, "TRY", {
                            showSymbol: false,
                          })}
                        </td>
                        <td className="px-2 py-2 text-right font-semibold">
                          {formatMoney(m.netMinor, "TRY", {
                            showSymbol: false,
                            signed: true,
                          })}
                        </td>
                        <td className="px-4 py-2 text-right sm:px-5">
                          {m.incomeMinor > 0
                            ? formatPercent(m.savingsRate, 0)
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>

            {/* Ay içi tempo */}
            <Panel>
              <PanelHeader
                title="Bu ayın temposu"
                subtitle={`${burn.daysElapsed}/${burn.daysInMonth} gün geçti`}
              />
              <div className="grid grid-cols-2 divide-x border-b sm:grid-cols-4">
                <Cell
                  label="Şu ana kadar"
                  value={formatMoney(burn.spentSoFarMinor)}
                />
                <Cell
                  label="Günlük ortalama"
                  value={formatMoney(burn.dailyAverageMinor)}
                />
                <Cell
                  label="Ay sonu tahmini"
                  value={formatMoney(burn.projectedMonthEndMinor)}
                  tone="gider"
                />
                <Cell
                  label="Geçen aya göre"
                  value={
                    burn.vsPreviousRatio != null
                      ? `${burn.vsPreviousRatio > 0 ? "+" : ""}${formatPercent(burn.vsPreviousRatio, 0)}`
                      : "—"
                  }
                  tone={
                    burn.vsPreviousRatio == null
                      ? "nötr"
                      : burn.vsPreviousRatio > 0
                        ? "gider"
                        : "gelir"
                  }
                />
              </div>
            </Panel>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {/* Kategori dağılımı */}
              <Panel>
                <PanelHeader
                  title="Kategori dağılımı"
                  subtitle={`${formatMonthTR(month)} · üst kategorilerde toplanmış`}
                />
                <CategoryBars
                  data={breakdown.map((c) => ({
                    name: c.name,
                    amountMinor: c.amountMinor,
                    ratio: c.ratio,
                    changeRatio: c.changeRatio,
                    txCount: c.txCount,
                  }))}
                />
              </Panel>

              {/* En çok harcanan yerler */}
              <Panel>
                <PanelHeader
                  title="En çok harcanan yerler"
                  subtitle={formatMonthTR(month)}
                />
                {merchants.length === 0 ? (
                  <EmptyState
                    icon={<Store size={26} />}
                    title="Bu ay işyeri kaydı yok"
                  />
                ) : (
                  <ul>
                    {merchants.map((m) => (
                      <li
                        key={`${m.merchantId}-${m.name}`}
                        className="flex items-center gap-3 border-b px-4 py-2.5 last:border-b-0 sm:px-5"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">
                            {m.name}
                          </p>
                          <p className="faint text-[11px]">{m.txCount} işlem</p>
                        </div>
                        <Money
                          minor={m.amountMinor}
                          className="text-sm font-semibold"
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            </div>

            {/* Bütçe durumu */}
            {budgets.length > 0 ? (
              <Panel>
                <PanelHeader
                  title="Bütçe durumu"
                  subtitle={formatMonthTR(month)}
                  action={
                    <Link
                      href="/butce"
                      className="focus-ring text-brand-600 dark:text-brand-300 text-xs font-medium"
                    >
                      Düzenle
                    </Link>
                  }
                />
                <ul>
                  {budgets.map((b) => (
                    <li key={b.categoryId} className="px-4 py-2.5 sm:px-5">
                      <div className="mb-1.5 flex items-baseline justify-between gap-3">
                        <span className="flex items-center gap-1.5 truncate text-xs font-medium">
                          {b.isOver ? (
                            <AlertTriangle
                              size={12}
                              className="text-gider shrink-0"
                            />
                          ) : (
                            <ShieldCheck
                              size={12}
                              className="text-gelir shrink-0"
                            />
                          )}
                          {b.name}
                        </span>
                        <span className="tabular shrink-0 text-xs">
                          <span
                            className={
                              b.isOver
                                ? "text-gider font-semibold"
                                : "font-semibold"
                            }
                          >
                            {formatMoney(b.spentMinor, "TRY", {
                              showSymbol: false,
                            })}
                          </span>
                          <span className="para faint">
                            {" "}
                            / {formatMoney(b.budgetMinor)}
                          </span>
                        </span>
                      </div>
                      <ProgressBar
                        ratio={b.ratio}
                        tone={b.isOver ? "gider" : "gelir"}
                      />
                    </li>
                  ))}
                </ul>
              </Panel>
            ) : null}
          </div>
        </details>
      )}
    </div>
  );
}

function Cell({
  label,
  value,
  tone = "nötr",
}: {
  label: string;
  value: string;
  tone?: "nötr" | "gelir" | "gider";
}) {
  return (
    <div className="border-b px-3 py-2.5 sm:border-b-0">
      <p className="faint text-[10px] tracking-wide uppercase">{label}</p>
      <p
        className={`tabular mt-0.5 text-sm font-semibold ${
          tone === "gelir" ? "text-gelir" : tone === "gider" ? "text-gider" : ""
        }`}
      >
        {value}
      </p>
    </div>
  );
}
