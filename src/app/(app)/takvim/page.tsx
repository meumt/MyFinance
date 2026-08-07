import { CalendarClock, TrendingDown, TrendingUp } from "lucide-react";

import { CashflowChart } from "@/components/charts";
import { Alert, Money, ObligationRow } from "@/components/display";
import { Badge, EmptyState, Panel, PanelHeader } from "@/components/ui";
import { loadSnapshot } from "@/lib/data";
import {
  formatDateTR,
  formatMonthTR,
  monthKey,
  relativeDayTR,
} from "@/lib/dates";
import { cashflowProjection, upcomingObligations } from "@/lib/forecast";
import { formatMoney } from "@/lib/money";

export const metadata = { title: "Ödeme takvimi" };
export const dynamic = "force-dynamic";

const TYPE_LABEL: Record<string, string> = {
  kart_ekstre: "Kart ekstresi",
  kredi_taksit: "Kredi taksiti",
  abonelik: "Abonelik",
  duzenli_gider: "Düzenli gider",
  duzenli_gelir: "Düzenli gelir",
};

export default async function CalendarPage() {
  const snap = await loadSnapshot();

  const obligations = upcomingObligations(snap, { days: 180 });
  const cashflow = cashflowProjection(snap, 90);

  const outflow = obligations
    .filter((o) => !o.isIncome)
    .reduce((s, o) => s + o.amountMinor, 0);
  const inflow = obligations
    .filter((o) => o.isIncome)
    .reduce((s, o) => s + o.amountMinor, 0);

  /* Aya göre gruplanmış liste — 6 aylık ufuk tek listede boğulmasın. */
  const byMonth = obligations.reduce<Map<string, typeof obligations>>(
    (map, o) => {
      const key = monthKey(o.date);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(o);
      return map;
    },
    new Map(),
  );

  const overdue = obligations.filter((o) => o.daysUntil < 0);

  return (
    <div className="space-y-4">
      {cashflow.firstNegativeDate ? (
        <Alert
          sensitive
          tone={
            cashflow.days.some((d) => d.exceedsOverdraft) ? "gider" : "uyari"
          }
          title={`Bakiye ${formatDateTR(cashflow.firstNegativeDate)} tarihinde eksiye düşüyor`}
        >
          En düşük nokta{" "}
          <strong>{formatMoney(cashflow.minBalanceMinor)}</strong>
          {cashflow.minBalanceDate
            ? ` (${formatDateTR(cashflow.minBalanceDate)})`
            : ""}
          .{" "}
          {cashflow.overdraftHeadroomMinor > 0
            ? `Ek hesap limitiniz ${formatMoney(cashflow.overdraftHeadroomMinor)} — ${
                cashflow.days.some((d) => d.exceedsOverdraft)
                  ? "bu da yetmiyor."
                  : "bu açığı kapatabilir ama faiz işler."
              }`
            : "Ek hesap limitiniz yok."}
        </Alert>
      ) : null}

      {overdue.length > 0 ? (
        <Alert
          sensitive
          tone="gider"
          title={`${overdue.length} gecikmiş ödeme`}
        >
          {overdue
            .slice(0, 4)
            .map(
              (o) => `${o.label} — ${formatMoney(o.amountMinor, o.currency)}`,
            )
            .join(" · ")}
        </Alert>
      ) : null}

      {/* Nakit akışı projeksiyonu */}
      <Panel>
        <PanelHeader
          title="Nakit akışı projeksiyonu"
          subtitle="Önümüzdeki 90 gün — planlanan ödemeler bakiyenizi nasıl etkiliyor"
        />
        <div className="grid grid-cols-2 divide-x border-b sm:grid-cols-4">
          <Cell
            label="Bugünkü bakiye"
            value={formatMoney(cashflow.startBalanceMinor)}
          />
          <Cell
            label="90 gün çıkış"
            value={formatMoney(cashflow.totalOutflowMinor)}
            tone="gider"
            icon={<TrendingDown size={12} />}
          />
          <Cell
            label="90 gün giriş"
            value={formatMoney(cashflow.totalInflowMinor)}
            tone="gelir"
            icon={<TrendingUp size={12} />}
          />
          <Cell
            label="En düşük bakiye"
            value={formatMoney(cashflow.minBalanceMinor)}
            tone={cashflow.minBalanceMinor < 0 ? "gider" : "nötr"}
          />
        </div>
        <div className="p-3 sm:p-4">
          <CashflowChart
            data={cashflow.days.map((d) => ({
              date: d.date,
              balanceMinor: d.balanceMinor,
            }))}
            overdraftMinor={cashflow.overdraftHeadroomMinor}
          />
          <p className="faint mt-2 text-[11px] leading-relaxed">
            Projeksiyon yalnızca <strong>bilinen</strong> ödemeleri içerir: kart
            ekstreleri, kredi taksitleri, abonelikler ve düzenli gelir/giderler.
            Günlük harcamalar dahil değildir — gerçek bakiyeniz bu çizginin
            altında seyredecektir.
          </p>
        </div>
      </Panel>

      {/* Ödeme listesi */}
      <Panel>
        <PanelHeader
          sensitive
          title="Yaklaşan ödemeler"
          subtitle={`6 aylık ufuk · ${formatMoney(outflow)} çıkış${inflow > 0 ? ` · ${formatMoney(inflow)} giriş` : ""}`}
        />

        {obligations.length === 0 ? (
          <EmptyState
            icon={<CalendarClock size={28} />}
            title="Planlanan ödeme yok"
            description="Kart, kredi, abonelik ve düzenli giderleri girdiğinizde ödeme takviminiz burada oluşur."
          />
        ) : (
          <div>
            {[...byMonth.entries()].map(([month, items]) => {
              const monthOut = items
                .filter((o) => !o.isIncome)
                .reduce((s, o) => s + o.amountMinor, 0);

              return (
                <div key={month}>
                  <div className="surface-2 sticky top-14 z-10 flex items-center justify-between px-4 py-2 sm:px-5 lg:top-14">
                    <span className="text-xs font-semibold">
                      {formatMonthTR(month)}
                    </span>
                    <span className="tabular muted text-xs font-medium">
                      {formatMoney(monthOut)}
                    </span>
                  </div>
                  <ul>
                    {items.map((o, i) => (
                      <ObligationRow
                        key={`${o.type}-${o.entityId}-${o.date}-${i}`}
                        item={{
                          date: o.date,
                          label: o.label,
                          detail: `${TYPE_LABEL[o.type] ?? o.type} · ${o.detail}`,
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
                                  : "/duzenli",
                        }}
                      />
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        )}
      </Panel>

      {/* Riskli günler */}
      {cashflow.days.some((d) => d.isNegative) ? (
        <Panel>
          <PanelHeader
            title="Dikkat edilmesi gereken günler"
            subtitle="Bakiyenin eksiye düştüğü tarihler"
          />
          <ul>
            {cashflow.days
              .filter((d) => d.isNegative && d.obligations.length > 0)
              .slice(0, 10)
              .map((day) => (
                <li
                  key={day.date}
                  className="flex items-center gap-3 border-b px-4 py-2.5 last:border-b-0 sm:px-5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">
                      {formatDateTR(day.date)}
                      <span className="faint ml-1.5 text-[11px] font-normal">
                        {relativeDayTR(day.date)}
                      </span>
                    </p>
                    <p className="faint truncate text-[11px]">
                      {day.obligations.map((o) => o.label).join(", ")}
                    </p>
                  </div>
                  {day.exceedsOverdraft ? (
                    <Badge tone="gider">limit aşımı</Badge>
                  ) : (
                    <Badge tone="uyari">ek hesaba düşer</Badge>
                  )}
                  <Money
                    minor={day.balanceMinor}
                    className="text-gider shrink-0 text-sm font-semibold"
                  />
                </li>
              ))}
          </ul>
        </Panel>
      ) : null}
    </div>
  );
}

function Cell({
  label,
  value,
  tone = "nötr",
  icon,
}: {
  label: string;
  value: string;
  tone?: "nötr" | "gelir" | "gider";
  icon?: React.ReactNode;
}) {
  return (
    <div className="border-b px-3 py-2.5 last:border-b-0 sm:border-b-0">
      <p className="faint flex items-center gap-1 text-[10px] tracking-wide uppercase">
        {icon}
        {label}
      </p>
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
