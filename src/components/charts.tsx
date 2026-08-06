"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Area,
  AreaChart,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ReactNode } from "react";

import { formatMonthShortTR } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { cn } from "./ui";

/**
 * Grafik bileşenleri.
 *
 * Renkler CSS değişkenlerinden gelir; tema değişince SVG kendiliğinden uyum
 * sağlar. Renk körlüğü ayrımı sınırda olan çiftlerde (gelir/gider) kimlik
 * asla renge bırakılmaz — gösterge, işaret ve değer etiketi her zaman vardır.
 */

const AXIS_STYLE = {
  fontSize: 11,
  fill: "var(--chart-axis)",
} as const;

const GRID_STYLE = {
  stroke: "var(--chart-grid)",
  strokeDasharray: "3 3",
} as const;

/** Kısa para biçimi — eksen etiketlerinde yer kazandırır. */
function shortMoney(minor: number): string {
  return formatMoney(minor, "TRY", { showSymbol: false, compact: true });
}

/* ────────────────────────────── Ortak ipucu ──────────────────────────────── */

interface TooltipRow {
  label: string;
  value: string;
  color?: string;
}

function TooltipCard({
  title,
  rows,
  footer,
}: {
  title: string;
  rows: TooltipRow[];
  footer?: ReactNode;
}) {
  return (
    <div className="surface tabular rounded-lg px-3 py-2 text-xs shadow-lg">
      <p className="mb-1.5 font-semibold">{title}</p>
      <div className="space-y-1">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-4">
            <span className="muted flex items-center gap-1.5">
              {row.color ? (
                <span
                  className="h-2 w-2 shrink-0 rounded-sm"
                  style={{ backgroundColor: row.color }}
                />
              ) : null}
              {row.label}
            </span>
            <span className="font-medium">{row.value}</span>
          </div>
        ))}
      </div>
      {footer ? <div className="muted mt-1.5 border-t pt-1.5">{footer}</div> : null}
    </div>
  );
}

/* ──────────────────────── Gelecek aylara taksit yükü ─────────────────────── */

export interface InstallmentPoint {
  month: string;
  totalMinor: number;
  byCard: Array<{ cardId: number; cardName: string; amountMinor: number }>;
}

/**
 * Tek serili sütun grafiği: her ay ödenmesi gereken toplam taksit.
 * Kart kırılımı ipucunda gösterilir — yığın yerine tek seri tercih edildi,
 * çünkü buradaki soru "hangi ay ne kadar", "hangi kart" değil.
 */
export function InstallmentLoadChart({ data }: { data: InstallmentPoint[] }) {
  const chartData = data.map((d) => ({
    month: d.month,
    label: formatMonthShortTR(d.month),
    total: d.totalMinor / 100,
    byCard: d.byCard,
  }));

  const peak = Math.max(...chartData.map((d) => d.total), 0);

  return (
    <div className="h-56 w-full sm:h-64">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
          <CartesianGrid {...GRID_STYLE} vertical={false} />
          <XAxis
            dataKey="label"
            tick={AXIS_STYLE}
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
            minTickGap={4}
          />
          <YAxis
            tick={AXIS_STYLE}
            tickLine={false}
            axisLine={false}
            width={52}
            tickFormatter={(v: number) => shortMoney(v * 100)}
          />
          <Tooltip
            cursor={{ fill: "var(--chart-grid)", opacity: 0.5 }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const point = payload[0].payload as (typeof chartData)[number];
              return (
                <TooltipCard
                  title={formatMonthShortTR(point.month)}
                  rows={[
                    ...point.byCard.map((c) => ({
                      label: c.cardName,
                      value: formatMoney(c.amountMinor),
                    })),
                  ]}
                  footer={
                    <span className="font-medium">
                      Toplam {formatMoney(point.total * 100)}
                    </span>
                  }
                />
              );
            }}
          />
          <Bar dataKey="total" radius={[4, 4, 0, 0]} maxBarSize={40}>
            {chartData.map((d) => (
              <Cell
                key={d.month}
                // En yüksek yükün olduğu ay vurgulanır — dikkat edilmesi gereken ay odur.
                fill={d.total >= peak && peak > 0 ? "var(--chart-2)" : "var(--chart-1)"}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ─────────────────────────── Aylık gelir / gider ─────────────────────────── */

export interface MonthlyPoint {
  month: string;
  incomeMinor: number;
  expenseMinor: number;
  netMinor: number;
}

export function IncomeExpenseChart({ data }: { data: MonthlyPoint[] }) {
  const chartData = data.map((d) => ({
    month: d.month,
    label: formatMonthShortTR(d.month),
    gelir: d.incomeMinor / 100,
    gider: d.expenseMinor / 100,
    net: d.netMinor / 100,
  }));

  return (
    <div className="h-60 w-full sm:h-72">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
          <CartesianGrid {...GRID_STYLE} vertical={false} />
          <XAxis
            dataKey="label"
            tick={AXIS_STYLE}
            tickLine={false}
            axisLine={false}
            minTickGap={4}
          />
          <YAxis
            tick={AXIS_STYLE}
            tickLine={false}
            axisLine={false}
            width={52}
            tickFormatter={(v: number) => shortMoney(v * 100)}
          />
          <Tooltip
            cursor={{ fill: "var(--chart-grid)", opacity: 0.5 }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload as (typeof chartData)[number];
              return (
                <TooltipCard
                  title={formatMonthShortTR(p.month)}
                  rows={[
                    {
                      label: "Gelir",
                      value: formatMoney(p.gelir * 100),
                      color: "var(--chart-gelir)",
                    },
                    {
                      label: "Gider",
                      value: formatMoney(p.gider * 100),
                      color: "var(--chart-gider)",
                    },
                  ]}
                  footer={
                    <span
                      className={cn(
                        "font-medium",
                        p.net >= 0 ? "text-gelir" : "text-gider",
                      )}
                    >
                      Net {p.net >= 0 ? "+" : ""}
                      {formatMoney(p.net * 100)}
                    </span>
                  }
                />
              );
            }}
          />
          {/* Gösterge zorunlu: renk körlüğü ayrımı sınır bandında. */}
          <Legend
            verticalAlign="top"
            height={28}
            iconType="square"
            iconSize={9}
            formatter={(value) => (
              <span style={{ color: "var(--text-muted)", fontSize: 11 }}>{value}</span>
            )}
          />
          <Bar
            dataKey="gelir"
            name="Gelir"
            fill="var(--chart-gelir)"
            radius={[4, 4, 0, 0]}
            maxBarSize={22}
          />
          <Bar
            dataKey="gider"
            name="Gider"
            fill="var(--chart-gider)"
            radius={[4, 4, 0, 0]}
            maxBarSize={22}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ──────────────────────────── Nakit akışı eğrisi ─────────────────────────── */

export interface CashflowPoint {
  date: string;
  balanceMinor: number;
}

/** Projeksiyon boyunca beklenen bakiye; sıfır çizgisi referans olarak durur. */
export function CashflowChart({
  data,
  overdraftMinor = 0,
}: {
  data: CashflowPoint[];
  overdraftMinor?: number;
}) {
  const chartData = data.map((d) => ({
    date: d.date,
    label: new Date(`${d.date}T00:00:00`).toLocaleDateString("tr-TR", {
      day: "numeric",
      month: "short",
    }),
    balance: d.balanceMinor / 100,
  }));

  const hasNegative = chartData.some((d) => d.balance < 0);

  return (
    <div className="h-56 w-full sm:h-64">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
          <defs>
            <linearGradient id="cashflowFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.25} />
              <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid {...GRID_STYLE} vertical={false} />
          <XAxis
            dataKey="label"
            tick={AXIS_STYLE}
            tickLine={false}
            axisLine={false}
            minTickGap={40}
          />
          <YAxis
            tick={AXIS_STYLE}
            tickLine={false}
            axisLine={false}
            width={52}
            tickFormatter={(v: number) => shortMoney(v * 100)}
          />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload as (typeof chartData)[number];
              return (
                <TooltipCard
                  title={new Date(`${p.date}T00:00:00`).toLocaleDateString("tr-TR", {
                    day: "numeric",
                    month: "long",
                  })}
                  rows={[
                    {
                      label: "Beklenen bakiye",
                      value: formatMoney(p.balance * 100),
                    },
                  ]}
                />
              );
            }}
          />
          <ReferenceLine
            y={0}
            stroke={hasNegative ? "var(--chart-gider)" : "var(--chart-axis)"}
            strokeWidth={hasNegative ? 2 : 1}
          />
          {overdraftMinor > 0 ? (
            <ReferenceLine
              y={-overdraftMinor / 100}
              stroke="var(--chart-gider)"
              strokeDasharray="4 4"
              strokeWidth={1}
              label={{
                value: "ek hesap sınırı",
                position: "insideBottomRight",
                fontSize: 10,
                fill: "var(--chart-gider)",
              }}
            />
          ) : null}
          <Area
            type="monotone"
            dataKey="balance"
            stroke="var(--chart-1)"
            strokeWidth={2}
            fill="url(#cashflowFill)"
            dot={false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--surface)" }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ────────────────────────── Borç kapatma projeksiyonu ────────────────────── */

export interface PayoffPoint {
  month: string;
  debtMinor: number;
}

export function PayoffChart({ data }: { data: PayoffPoint[] }) {
  const chartData = data.map((d) => ({
    month: d.month,
    label: formatMonthShortTR(d.month),
    debt: d.debtMinor / 100,
  }));

  return (
    <div className="h-52 w-full sm:h-60">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
          <CartesianGrid {...GRID_STYLE} vertical={false} />
          <XAxis
            dataKey="label"
            tick={AXIS_STYLE}
            tickLine={false}
            axisLine={false}
            minTickGap={24}
          />
          <YAxis
            tick={AXIS_STYLE}
            tickLine={false}
            axisLine={false}
            width={52}
            tickFormatter={(v: number) => shortMoney(v * 100)}
          />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload as (typeof chartData)[number];
              return (
                <TooltipCard
                  title={formatMonthShortTR(p.month)}
                  rows={[{ label: "Kalan borç", value: formatMoney(p.debt * 100) }]}
                />
              );
            }}
          />
          <ReferenceLine y={0} stroke="var(--chart-gelir)" strokeWidth={2} />
          <Line
            type="monotone"
            dataKey="debt"
            stroke="var(--chart-2)"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--surface)" }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ─────────────────────── Kategori dağılımı (yatay çubuk) ─────────────────── */

export interface CategoryBar {
  name: string;
  amountMinor: number;
  ratio: number;
  changeRatio: number | null;
  txCount: number;
}

/**
 * Kategori kırılımı pasta yerine yatay çubukla gösterilir: karşılaştırma
 * kolaylaşır ve her çubuk doğrudan etiketlenir, kimlik renge bağlı kalmaz.
 * Renk tek hueli bir ramp — büyüklüğü kodlar, kimliği değil.
 */
export function CategoryBars({ data }: { data: CategoryBar[] }) {
  if (data.length === 0) {
    return (
      <p className="muted px-4 py-8 text-center text-xs">
        Bu ay için harcama kaydı yok.
      </p>
    );
  }

  const max = Math.max(...data.map((d) => d.amountMinor), 1);
  const rampSteps = [
    "var(--chart-ramp-5)",
    "var(--chart-ramp-4)",
    "var(--chart-ramp-3)",
    "var(--chart-ramp-2)",
    "var(--chart-ramp-1)",
  ];

  return (
    <ul className="divide-y">
      {data.map((row, index) => {
        const step = rampSteps[Math.min(index, rampSteps.length - 1)];
        return (
          <li key={row.name} className="px-4 py-2.5 sm:px-5">
            <div className="mb-1.5 flex items-baseline justify-between gap-3">
              <span className="truncate text-xs font-medium">{row.name}</span>
              <span className="tabular shrink-0 text-xs font-semibold">
                {formatMoney(row.amountMinor)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--surface-3)]">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${(row.amountMinor / max) * 100}%`,
                    backgroundColor: step,
                  }}
                />
              </div>
              <span className="faint tabular w-10 shrink-0 text-right text-[11px]">
                %{Math.round(row.ratio * 100)}
              </span>
              {row.changeRatio != null ? (
                <span
                  className={cn(
                    "tabular w-12 shrink-0 text-right text-[11px]",
                    row.changeRatio > 0.02
                      ? "text-gider"
                      : row.changeRatio < -0.02
                        ? "text-gelir"
                        : "faint",
                  )}
                  title="Geçen aya göre değişim"
                >
                  {row.changeRatio > 0 ? "▲" : row.changeRatio < 0 ? "▼" : "—"}
                  {Math.abs(Math.round(row.changeRatio * 100))}%
                </span>
              ) : (
                <span className="faint w-12 shrink-0 text-right text-[11px]">yeni</span>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
