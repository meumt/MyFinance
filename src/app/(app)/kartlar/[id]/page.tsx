import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { initialsOf, Money, TransactionRow } from "@/components/display";
import {
  Badge,
  EmptyState,
  Panel,
  PanelHeader,
  ProgressBar,
} from "@/components/ui";
import { categoryPath, loadSnapshot } from "@/lib/data";
import { formatDateTR, monthKey } from "@/lib/dates";
import { formatMoney, formatPercent } from "@/lib/money";
import { STATEMENT_STATUS_LABEL, type StatementStatus } from "@/lib/statements";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const snap = await loadSnapshot();
  const card = snap.cardById.get(Number(id));
  return { title: card?.name ?? "Kart" };
}

const STATUS_TONE: Record<StatementStatus, "nötr" | "gelir" | "gider" | "uyari" | "brand"> = {
  acik: "brand",
  kapali: "uyari",
  odendi: "gelir",
  kismi: "uyari",
  gecikmis: "gider",
};

export default async function CardDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const cardId = Number(id);
  if (!Number.isInteger(cardId)) notFound();

  const snap = await loadSnapshot();
  const card = snap.cardById.get(cardId);
  if (!card) notFound();

  const ledger = snap.ledgers.get(cardId);
  const institution = card.institutionId
    ? snap.institutionById.get(card.institutionId)
    : undefined;

  /* Gösterilecek dönemler: son 6 kapalı + açık + gelecek 6. */
  const periods = ledger?.periods ?? [];
  const currentIndex = periods.findIndex((p) => p.isCurrent);
  const anchor = currentIndex >= 0 ? currentIndex : periods.length - 1;
  const visible = periods
    .slice(Math.max(0, anchor - 6), anchor + 7)
    .filter((p) => p.totalDueMinor !== 0 || p.chargesMinor !== 0 || p.installmentsMinor !== 0)
    .reverse();

  const cardPlans = snap.plans.filter((p) => p.cardId === cardId && p.status === "aktif");
  const cardTx = snap.transactions
    .filter((t) => t.cardId === cardId || t.counterCardId === cardId)
    .slice(0, 15);

  return (
    <div className="space-y-4">
      <Link
        href="/kartlar"
        className="muted focus-ring inline-flex items-center gap-1.5 text-xs font-medium hover:text-[var(--text)]"
      >
        <ArrowLeft size={14} />
        Kartlar
      </Link>

      {/* Kart başlığı */}
      <Panel className="overflow-hidden">
        <div
          className="px-4 py-5 text-white sm:px-5"
          style={{
            background: `linear-gradient(135deg, ${card.color}, ${card.color}cc)`,
          }}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-base font-semibold">{card.name}</p>
              <p className="mt-0.5 text-xs opacity-80">
                {institution?.name ?? "Kurum belirtilmemiş"}
                {card.lastFour ? ` · •••• ${card.lastFour}` : ""}
              </p>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-[10px] tracking-wide uppercase opacity-75">
                Toplam borç
              </p>
              <p className="tabular text-lg font-semibold">
                {formatMoney(ledger?.totalDebtMinor ?? 0, card.currency)}
              </p>
            </div>
          </div>

          {card.statementDay && card.dueDay ? (
            <p className="mt-3 text-[11px] opacity-80">
              Hesap kesim: her ayın {card.statementDay}'i · Son ödeme: {card.dueDay}'i
            </p>
          ) : null}
        </div>

        <div className="grid grid-cols-2 divide-x sm:grid-cols-4">
          <Cell label="Dönem borcu" value={formatMoney(ledger?.currentDueMinor ?? 0, card.currency)} />
          <Cell
            label="Açık dönem"
            value={formatMoney(ledger?.openPeriodSpendMinor ?? 0, card.currency)}
          />
          <Cell
            label="Gelecek taksit"
            value={formatMoney(ledger?.remainingInstallmentsMinor ?? 0, card.currency)}
          />
          <Cell
            label="Kalan limit"
            value={formatMoney(ledger?.availableLimitMinor ?? 0, card.currency)}
          />
        </div>

        {card.creditLimitMinor > 0 ? (
          <div className="px-4 pb-4 sm:px-5">
            <ProgressBar
              ratio={ledger?.utilizationRatio ?? 0}
              tone={
                (ledger?.utilizationRatio ?? 0) > 0.9
                  ? "gider"
                  : (ledger?.utilizationRatio ?? 0) > 0.7
                    ? "uyari"
                    : "brand"
              }
            />
            <p className="faint mt-1 text-[10px]">
              {formatPercent(ledger?.utilizationRatio ?? 0, 0)} dolu ·{" "}
              {formatMoney(card.creditLimitMinor, card.currency)} limit
            </p>
          </div>
        ) : null}
      </Panel>

      {/* Ekstre defteri */}
      <Panel>
        <PanelHeader
          title="Ekstre dönemleri"
          subtitle="Devreden borç, dönem harcaması ve taksitlerle birlikte"
        />
        {visible.length === 0 ? (
          <EmptyState
            title="Henüz ekstre oluşmadı"
            description="Bu karta harcama girdiğinizde dönemler burada listelenir."
          />
        ) : (
          <div className="table-scroll">
            <table className="w-full min-w-[42rem] text-xs">
              <thead>
                <tr className="faint border-b text-left">
                  <th className="px-4 py-2 font-medium sm:px-5">Dönem</th>
                  <th className="px-2 py-2 text-right font-medium">Devreden</th>
                  <th className="px-2 py-2 text-right font-medium">Harcama</th>
                  <th className="px-2 py-2 text-right font-medium">Taksit</th>
                  <th className="px-2 py-2 text-right font-medium">Dönem borcu</th>
                  <th className="px-2 py-2 text-right font-medium">Asgari</th>
                  <th className="px-2 py-2 text-right font-medium">Ödenen</th>
                  <th className="px-4 py-2 text-right font-medium sm:px-5">Durum</th>
                </tr>
              </thead>
              <tbody className="tabular">
                {visible.map((p) => (
                  <tr
                    key={p.period.monthKey}
                    className={`border-b last:border-b-0 ${p.isCurrent ? "bg-brand-500/5" : ""}`}
                  >
                    <td className="px-4 py-2.5 sm:px-5">
                      <span className="font-medium">
                        {formatDateTR(p.period.statementDate)}
                      </span>
                      <span className="faint block text-[10px]">
                        ödeme {formatDateTR(p.period.dueDate)}
                      </span>
                    </td>
                    <td className="muted px-2 py-2.5 text-right">
                      {p.carryInMinor !== 0
                        ? formatMoney(p.carryInMinor, card.currency, { showSymbol: false })
                        : "—"}
                    </td>
                    <td className="px-2 py-2.5 text-right">
                      {p.chargesMinor !== 0
                        ? formatMoney(p.chargesMinor, card.currency, { showSymbol: false })
                        : "—"}
                    </td>
                    <td className="px-2 py-2.5 text-right">
                      {p.installmentsMinor !== 0
                        ? formatMoney(p.installmentsMinor, card.currency, { showSymbol: false })
                        : "—"}
                    </td>
                    <td className="px-2 py-2.5 text-right font-semibold">
                      {formatMoney(p.totalDueMinor, card.currency, { showSymbol: false })}
                    </td>
                    <td className="muted px-2 py-2.5 text-right">
                      {p.minimumDueMinor > 0
                        ? formatMoney(p.minimumDueMinor, card.currency, { showSymbol: false })
                        : "—"}
                    </td>
                    <td className="text-gelir px-2 py-2.5 text-right">
                      {p.paymentsMinor > 0
                        ? formatMoney(p.paymentsMinor, card.currency, { showSymbol: false })
                        : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-right sm:px-5">
                      <Badge tone={STATUS_TONE[p.status]}>
                        {STATEMENT_STATUS_LABEL[p.status]}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Aktif taksit planları */}
        <Panel>
          <PanelHeader
            title="Bu karttaki taksitler"
            subtitle={`${cardPlans.length} aktif plan`}
            action={
              <Link
                href="/taksitler"
                className="focus-ring text-brand-600 dark:text-brand-300 text-xs font-medium"
              >
                Tümü
              </Link>
            }
          />
          {cardPlans.length === 0 ? (
            <EmptyState title="Taksitli alışveriş yok" />
          ) : (
            <ul>
              {cardPlans.map((plan) => {
                const rows = snap.installments.filter((i) => i.planId === plan.id);
                const paid = rows.filter((i) => i.isPaid).length;
                const remaining = rows
                  .filter((i) => !i.isPaid)
                  .reduce((s, i) => s + i.amountMinor, 0);

                return (
                  <li key={plan.id} className="border-b px-4 py-3 last:border-b-0 sm:px-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{plan.description}</p>
                        <p className="faint mt-0.5 text-[11px]">
                          {paid}/{plan.installmentCount} taksit ödendi ·{" "}
                          {formatMoney(plan.totalAmountMinor, plan.currency)} toplam
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <Money
                          minor={remaining}
                          currency={plan.currency}
                          className="block text-sm font-semibold"
                        />
                        <span className="faint text-[10px]">kalan</span>
                      </div>
                    </div>
                    <div className="mt-2">
                      <ProgressBar
                        ratio={plan.installmentCount > 0 ? paid / plan.installmentCount : 0}
                        tone="gelir"
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        {/* Kart hareketleri */}
        <Panel>
          <PanelHeader title="Son hareketler" subtitle="Bu karta ait" />
          {cardTx.length === 0 ? (
            <EmptyState title="Hareket yok" />
          ) : (
            <ul>
              {cardTx.map((tx) => {
                const category = tx.categoryId
                  ? snap.categoryById.get(tx.categoryId)
                  : undefined;
                const title =
                  tx.description ??
                  (tx.merchantId ? snap.merchantById.get(tx.merchantId)?.name : null) ??
                  categoryPath(category, snap.categoryById);

                return (
                  <TransactionRow
                    key={tx.id}
                    date={tx.date}
                    title={title}
                    subtitle={
                      tx.kind === "kart_odeme"
                        ? "kart ödemesi"
                        : (category?.name ?? monthKey(tx.date))
                    }
                    amountMinor={tx.amountMinor}
                    currency={tx.currency}
                    kind={tx.kind}
                    color={category?.color ?? card.color}
                    initials={initialsOf(title)}
                  />
                );
              })}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-b px-3 py-2.5 sm:border-b-0">
      <p className="faint text-[10px] tracking-wide uppercase">{label}</p>
      <p className="tabular mt-0.5 text-sm font-semibold">{value}</p>
    </div>
  );
}
