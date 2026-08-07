import {
  CalendarClock,
  CircleAlert,
  PiggyBank,
  TrendingDown,
  TrendingUp,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { OutlookChart } from "@/components/charts";
import { Alert, Gizli, Money } from "@/components/display";
import { Badge, Panel, PanelHeader } from "@/components/ui";
import { formatMonthTR } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import type { Outlook } from "@/lib/outlook";
import { LivingCostForm } from "./living-cost";

/**
 * "Önümü göremiyorum" ekranı.
 *
 * Tek iş yapar: bugünkü durumu ve bilinen gelecek ödemeleri düz cümleye
 * çevirir. Grafik ve tablo cümleleri destekler, cümlelerin yerini almaz.
 */
export function PlanPanel({
  outlook,
  currentMonth,
}: {
  outlook: Outlook;
  currentMonth: string;
}) {
  const {
    startBalanceMinor: start,
    overdraftHeadroomMinor: headroom,
    months,
  } = outlook;

  const lastMonth = months[months.length - 1];

  return (
    <Panel id="plan">
      <PanelHeader
        title="Önümdeki aylar"
        subtitle="Bugünkü bakiyen ve bilinen ödemelerinle ay ay ne olacağı"
      />

      {/* Bugün nerede duruyoruz */}
      <div className="grid grid-cols-2 divide-x border-b sm:grid-cols-4">
        <Cell
          icon={<Wallet size={13} />}
          label="Bugün cepte"
          value={formatMoney(start)}
          tone={start >= 0 ? "gelir" : "gider"}
          sub={
            headroom > 0
              ? `+ ${formatMoney(headroom, "TRY", { compact: true })} ek hesap`
              : undefined
          }
        />
        <Cell
          icon={<TrendingDown size={13} />}
          label="En dip nokta"
          value={
            outlook.tightestIsToday
              ? "Bugün"
              : outlook.tightestMonth
                ? formatMonthTR(outlook.tightestMonth)
                : "—"
          }
          sub={`${outlook.tightestIsToday ? "" : "ay sonu "}${formatMoney(outlook.tightestMinor, "TRY", { compact: true })}`}
          tone={outlook.tightestMinor < 0 ? "gider" : "nötr"}
        />
        <Cell
          icon={<CalendarClock size={13} />}
          label="Taksitler bitiyor"
          value={
            outlook.installmentFreeMonth
              ? formatMonthTR(outlook.installmentFreeMonth)
              : "Taksit yok"
          }
          sub={
            outlook.freedAfterInstallmentsMinor > 0
              ? `ayda ${formatMoney(outlook.freedAfterInstallmentsMinor, "TRY", { compact: true })}`
              : undefined
          }
        />
        <Cell
          icon={<PiggyBank size={13} />}
          label="Yatırıma kalan"
          value={
            outlook.investableMonthlyMinor > 0
              ? `${formatMoney(outlook.investableMonthlyMinor, "TRY", { compact: true })}/ay`
              : "—"
          }
          sub={
            outlook.investableFromMonth
              ? `${formatMonthTR(outlook.investableFromMonth)} sonrası`
              : "düzene girince"
          }
          tone={outlook.investableMonthlyMinor > 0 ? "gelir" : "nötr"}
        />
      </div>

      {/* Eksik varsayımlar — plan bunlarsız yanıltır */}
      {!outlook.hasIncome || outlook.assumedLivingCostMinor === 0 ? (
        <div className="space-y-2.5 border-b px-4 py-3.5 sm:px-5">
          {!outlook.hasIncome ? (
            <Alert
              tone="gider"
              title="Maaşını girmemişsin — plan çalışmıyor"
              action={
                <Link
                  href="/duzenli"
                  className="focus-ring text-xs font-semibold underline underline-offset-2"
                >
                  Ekle
                </Link>
              }
            >
              Düzenli gelirin tanımlı olmadığı için aşağıdaki tabloda hiç para
              girmiyor. Düzenli kalemler ekranından maaşını ve tarihini gir,
              plan anında düzelsin.
            </Alert>
          ) : null}

          {outlook.assumedLivingCostMinor === 0 ? (
            <Alert
              tone="uyari"
              title="Aylık yaşam giderini gir, plan gerçekçi olsun"
            >
              <p>
                Aşağıdaki hesap yalnızca bilinen ödemeleri (kart ekstresi,
                taksit, kredi, abonelik) sayıyor. Market, ulaşım, yemek gibi
                günlük harcamalar girilmediği için tablo olduğundan iyimser.
                Kabaca bir aylık tutar yaz, yeter.
              </p>
              <div className="mt-2.5">
                <LivingCostForm valueMinor={outlook.assumedLivingCostMinor} />
              </div>
            </Alert>
          ) : null}
        </div>
      ) : null}

      {/* Düz cümleyle özet */}
      <ul className="divide-y border-b">
        {buildInsights(outlook, currentMonth).map((insight) => (
          <li
            key={insight.key}
            className="flex items-start gap-3 px-4 py-3 sm:px-5"
          >
            <span
              className={`mt-0.5 shrink-0 ${
                insight.tone === "gelir"
                  ? "text-gelir"
                  : insight.tone === "gider"
                    ? "text-gider"
                    : insight.tone === "uyari"
                      ? "text-uyari"
                      : "muted"
              }`}
            >
              {insight.icon}
            </span>
            <p className="para text-sm leading-relaxed">{insight.text}</p>
          </li>
        ))}
      </ul>

      <div className="p-3 sm:p-4">
        <OutlookChart
          data={months.map((m) => ({
            month: m.month,
            closingMinor: m.closingMinor,
          }))}
          overdraftMinor={headroom}
        />
      </div>

      {/* Ay ay döküm — mobilde de tek bakışta okunsun diye liste */}
      <ul className="border-t">
        {months.map((m) => (
          <li
            key={m.month}
            className={`px-4 py-2.5 sm:px-5 ${
              m.month === currentMonth ? "bg-[var(--surface-2)]" : ""
            } border-b last:border-b-0`}
          >
            <div className="flex items-baseline justify-between gap-3">
              <span className="truncate text-sm font-medium">
                {formatMonthTR(m.month)}
                {m.month === currentMonth ? (
                  <Badge tone="brand" className="ml-1.5">
                    bu ay
                  </Badge>
                ) : null}
                {m.month === outlook.installmentFreeMonth ? (
                  <Badge tone="gelir" className="ml-1.5">
                    son taksit
                  </Badge>
                ) : null}
              </span>
              <span className="shrink-0 text-right">
                <Money
                  minor={m.closingMinor}
                  signed
                  className="block text-sm font-semibold"
                />
                <span className="faint text-[10px]">ay sonu</span>
              </span>
            </div>

            <p className="para faint mt-0.5 text-[11px]">
              <span className="text-gelir">
                +{formatMoney(m.incomeMinor, "TRY", { showSymbol: false })}
              </span>
              {" giren · "}
              <span className="text-gider">
                −{formatMoney(m.outflowMinor, "TRY", { showSymbol: false })}
              </span>
              {" çıkan"}
              {m.installmentMinor > 0
                ? ` · içinde ${formatMoney(m.installmentMinor, "TRY", {
                    showSymbol: false,
                  })} taksit`
                : ""}
              {m.livingCostMinor > 0
                ? ` · ${formatMoney(m.livingCostMinor, "TRY", {
                    showSymbol: false,
                  })} yaşam gideri`
                : ""}
            </p>
          </li>
        ))}
      </ul>

      <p className="faint px-4 py-3 text-[11px] leading-relaxed sm:px-5">
        Hesap bugünkü hesap bakiyelerinden başlar; her ay bilinen kart
        ekstrelerini, taksitleri, kredi ödemelerini, abonelikleri ve düzenli
        gelir/giderleri işler. Kart ekstreleri her ay tamamen ödeniyor
        varsayılır — asgari ödeyip devrederseniz faiz eklenir, onun etkisi için{" "}
        <Link
          href="#borc"
          className="text-brand-600 dark:text-brand-300 font-medium underline underline-offset-2"
        >
          borçtan çıkış simülasyonuna
        </Link>{" "}
        bakın.
        {lastMonth
          ? ` Ufuk ${formatMonthTR(lastMonth.month)} ayında bitiyor.`
          : ""}
      </p>
    </Panel>
  );
}

/* ─────────────────────────── Cümleleri kuran yer ─────────────────────────── */

interface Insight {
  key: string;
  icon: ReactNode;
  tone: "gelir" | "gider" | "uyari" | "nötr";
  text: ReactNode;
}

function buildInsights(outlook: Outlook, currentMonth: string): Insight[] {
  const out: Insight[] = [];
  const {
    startBalanceMinor: start,
    overdraftHeadroomMinor: headroom,
    months,
  } = outlook;

  const money = (minor: number) => (
    <strong>{formatMoney(Math.abs(minor))}</strong>
  );

  /* 1) Bugün neredeyiz, ne zaman düzeliyor */
  if (start < 0) {
    if (outlook.firstPositiveMonth === currentMonth) {
      out.push({
        key: "durum",
        icon: <TrendingUp size={15} />,
        tone: "gelir",
        text: (
          <>
            Bugün {money(start)} eksidesin, ama bu ay içinde gelecek gelirler
            seni artıya çıkarıyor: ay sonunda{" "}
            {money(months[0]?.closingMinor ?? 0)} kalıyor.
          </>
        ),
      });
    } else if (outlook.firstPositiveMonth) {
      out.push({
        key: "durum",
        icon: <TrendingUp size={15} />,
        tone: "gelir",
        text: (
          <>
            Bugün {money(start)} eksidesin.{" "}
            <strong>{formatMonthTR(outlook.firstPositiveMonth)}</strong> ayında
            artıya geçiyorsun — o ayı bitirdiğinde cepte{" "}
            {money(
              months.find((m) => m.month === outlook.firstPositiveMonth)
                ?.closingMinor ?? 0,
            )}{" "}
            oluyor.
          </>
        ),
      });
    } else {
      out.push({
        key: "durum",
        icon: <CircleAlert size={15} />,
        tone: "gider",
        text: (
          <>
            Bugün {money(start)} eksidesin ve önümüzdeki {months.length} ay
            boyunca artıya geçmiyorsun. Giderleri kısmadan ya da gelir eklemeden
            bu tablo düzelmiyor.
          </>
        ),
      });
    }
  } else if (outlook.firstNegativeMonth) {
    out.push({
      key: "durum",
      icon: <TrendingDown size={15} />,
      tone: "uyari",
      text: (
        <>
          Bugün cebinde {money(start)} var, ama{" "}
          <strong>{formatMonthTR(outlook.firstNegativeMonth)}</strong> ayında
          bakiyen eksiye düşüyor. O aya kadar kenara para koymazsan sıkışırsın.
        </>
      ),
    });
  } else {
    out.push({
      key: "durum",
      icon: <TrendingUp size={15} />,
      tone: "gelir",
      text: (
        <>
          Bugün cebinde {money(start)} var ve önümüzdeki {months.length} ay
          boyunca bakiyen hiç eksiye düşmüyor.
          {outlook.tightestIsToday || !outlook.tightestMonth ? (
            <> En dip nokta bugün; buradan sonrası hep yukarı.</>
          ) : (
            <>
              {" "}
              En dip nokta{" "}
              <strong>{formatMonthTR(outlook.tightestMonth)}</strong> ayı sonu:{" "}
              {money(outlook.tightestMinor)}.
            </>
          )}
        </>
      ),
    });
  }

  /* 2) Ek hesap limiti de yetmiyorsa bu en kritik uyarıdır */
  if (outlook.firstOverdraftBreachMonth) {
    out.push({
      key: "kmh",
      icon: <CircleAlert size={15} />,
      tone: "gider",
      text: (
        <>
          <strong>{formatMonthTR(outlook.firstOverdraftBreachMonth)}</strong>{" "}
          ayında ek hesap limitin de yetmiyor
          {headroom > 0 ? <> ({money(headroom)} limit)</> : null}. O aydan önce
          bir ödemeyi ertelemen ya da nakit bulman gerekiyor.
        </>
      ),
    });
  } else if (
    outlook.tightestMinor < 0 &&
    headroom > 0 &&
    !outlook.tightestIsToday
  ) {
    out.push({
      key: "kmh",
      icon: <CircleAlert size={15} />,
      tone: "uyari",
      text: (
        <>
          <strong>{formatMonthTR(outlook.tightestMonth!)}</strong> sonunda{" "}
          {money(outlook.tightestMinor)} eksiye düşüyorsun; {money(headroom)} ek
          hesap limitin bunu karşılıyor ama faiz işleyecek.
        </>
      ),
    });
  }

  /* 3) Taksitler ne zaman bitiyor, ne kadar rahatlıyoruz */
  if (outlook.installmentFreeMonth && outlook.freedAfterInstallmentsMinor > 0) {
    out.push({
      key: "taksit",
      icon: <CalendarClock size={15} />,
      tone: "nötr",
      text: (
        <>
          Taksitler her ay {money(outlook.freedAfterInstallmentsMinor)} kadar
          yer kaplıyor. Son taksitin{" "}
          <strong>{formatMonthTR(outlook.installmentFreeMonth)}</strong> ayında
          ödeniyor; sonrasında bu tutar her ay cebinde kalıyor.
        </>
      ),
    });
  } else if (outlook.installmentFreeMonth) {
    out.push({
      key: "taksit",
      icon: <CalendarClock size={15} />,
      tone: "nötr",
      text: (
        <>
          Taksitlerin{" "}
          <strong>{formatMonthTR(outlook.installmentFreeMonth)}</strong> ayında
          bitiyor.
        </>
      ),
    });
  }

  /* 4) Düzene girince ne kalıyor — asıl sorulan soru */
  if (outlook.investableMonthlyMinor > 0) {
    out.push({
      key: "yatirim",
      icon: <PiggyBank size={15} />,
      tone: "gelir",
      text: (
        <>
          Düzene girdikten sonra ayda ortalama{" "}
          {money(outlook.investableMonthlyMinor)} artıyor — yatırıma ya da
          birikime ayırabileceğin tutar bu. Yılda{" "}
          {money(outlook.investableMonthlyMinor * 12)} eder.
        </>
      ),
    });
  } else if (outlook.assumedLivingCostMinor > 0) {
    out.push({
      key: "yatirim",
      icon: <PiggyBank size={15} />,
      tone: "uyari",
      text: (
        <>
          Taksitler bittikten sonra bile ayda{" "}
          {money(outlook.investableMonthlyMinor)} açık kalıyor. Bu tempoda
          yatırıma ayıracak para çıkmıyor; sabit giderlerine bakmak gerek.
        </>
      ),
    });
  }

  return out;
}

/* ─────────────────────────────── Küçük kutu ──────────────────────────────── */

function Cell({
  icon,
  label,
  value,
  sub,
  tone = "nötr",
}: {
  icon: ReactNode;
  label: string;
  value: string;
  sub?: string;
  tone?: "nötr" | "gelir" | "gider";
}) {
  return (
    <div className="border-b px-3 py-2.5 sm:border-b-0">
      <p className="faint flex items-center gap-1 text-[10px] tracking-wide uppercase">
        {icon}
        <span className="truncate">{label}</span>
      </p>
      <p
        className={`para tabular mt-0.5 truncate text-sm font-semibold ${
          tone === "gelir" ? "text-gelir" : tone === "gider" ? "text-gider" : ""
        }`}
      >
        {value}
      </p>
      {sub ? (
        <Gizli className="faint mt-0.5 block truncate text-[10px]">{sub}</Gizli>
      ) : null}
    </div>
  );
}
