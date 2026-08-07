import { flattenCategories, installmentLoad } from "@/lib/analytics";
import { loadSnapshot } from "@/lib/data";
import { monthKey } from "@/lib/dates";
import { toTRYOrZero } from "@/lib/fx";
import { describeInstallment } from "@/lib/installments";
import { InstallmentsClient, type PlanView } from "./installments-client";

export const metadata = { title: "Taksitler" };
export const dynamic = "force-dynamic";

export default async function InstallmentsPage() {
  const snap = await loadSnapshot();
  const loads = installmentLoad(snap, 18);

  const plans: PlanView[] = snap.plans
    .map((plan) => {
      const card = snap.cardById.get(plan.cardId);
      const ledger = card ? snap.ledgers.get(card.id) : undefined;

      /* Kapanmış ve borcu sıfırlanmış dönemler — taksitin ödenip ödenmediği
         buradan anlaşılır; kullanıcı tek tek işaretlemez. */
      const settledMonths = new Set(
        (ledger?.periods ?? [])
          .filter((p) => p.isClosed && p.carryOutMinor <= 0)
          .map((p) => p.period.monthKey),
      );

      const cycle =
        card?.statementDay != null && card.dueDay != null
          ? { statementDay: card.statementDay, dueDay: card.dueDay }
          : null;

      const rows = snap.installments
        .filter((i) => i.planId === plan.id)
        .sort((a, b) => a.seq - b.seq);

      const schedule = cycle
        ? rows.map((i) =>
            describeInstallment(i, {
              cycle,
              planEntryDate: new Intl.DateTimeFormat("en-CA", {
                timeZone: "Europe/Istanbul",
                year: "numeric",
                month: "2-digit",
                day: "2-digit",
              }).format(new Date(plan.createdAt)),
              settledMonths,
              ref: snap.ref,
            }),
          )
        : [];

      const remaining = schedule
        .filter((s) => s.countsAsDebt)
        .reduce((sum, s) => sum + s.amountMinor, 0);
      const settledCount = schedule.filter((s) => !s.countsAsDebt).length;
      const merchant = plan.merchantId ? snap.merchantById.get(plan.merchantId) : undefined;
      const next = schedule.find((s) => s.countsAsDebt);

      return {
        id: plan.id,
        cardId: plan.cardId,
        cardName: card?.name ?? "—",
        cardColor: card?.color ?? "#8b5cf6",
        statementDay: card?.statementDay ?? null,
        dueDay: card?.dueDay ?? null,
        description: plan.description,
        purchaseDate: plan.purchaseDate,
        totalAmountMinor: plan.totalAmountMinor,
        currency: plan.currency,
        installmentCount: plan.installmentCount,
        categoryId: plan.categoryId,
        merchantName: merchant?.name ?? null,
        notes: plan.notes,
        remainingMinor: remaining,
        settledCount,
        nextDueDate: next?.dueDate ?? null,
        nextAmountMinor: next?.amountMinor ?? 0,
        lastDueDate: schedule[schedule.length - 1]?.dueDate ?? null,
        schedule,
      };
    })
    .sort((a, b) => b.remainingMinor - a.remainingMinor);

  const currentMonth = monthKey(snap.ref);
  const totals = {
    remainingMinor: plans.reduce(
      (s, p) => s + toTRYOrZero(p.remainingMinor, p.currency, snap.rates),
      0,
    ),
    thisMonthMinor: loads.find((l) => l.month === currentMonth)?.totalMinor ?? 0,
    activePlans: plans.filter((p) => p.remainingMinor > 0).length,
  };

  return (
    <InstallmentsClient
      plans={plans}
      cards={snap.cards
        .filter((c) => c.isActive && c.statementDay != null && c.dueDay != null)
        .map((c) => ({
          value: c.id,
          label: c.name,
          statementDay: c.statementDay!,
          dueDay: c.dueDay!,
        }))}
      categories={flattenCategories(snap.categories, "gider")
        .filter((c) => c.isActive)
        .map((c) => ({ value: c.id, label: c.label }))}
      loadByMonth={loads.map((l) => ({
        month: l.month,
        totalMinor: l.totalMinor,
        byCard: l.byCard,
      }))}
      totals={totals}
    />
  );
}
