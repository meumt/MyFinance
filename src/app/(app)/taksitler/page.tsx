import { flattenCategories, installmentLoad } from "@/lib/analytics";
import { loadSnapshot } from "@/lib/data";
import { monthKey } from "@/lib/dates";
import { toTRYOrZero } from "@/lib/fx";
import { InstallmentsClient, type PlanView } from "./installments-client";

export const metadata = { title: "Taksitler" };
export const dynamic = "force-dynamic";

export default async function InstallmentsPage() {
  const snap = await loadSnapshot();
  const loads = installmentLoad(snap, 18);

  const plans: PlanView[] = snap.plans
    .map((plan) => {
      const card = snap.cardById.get(plan.cardId);
      const rows = snap.installments
        .filter((i) => i.planId === plan.id)
        .sort((a, b) => a.seq - b.seq);

      const unpaid = rows.filter((i) => !i.isPaid);
      const merchant = plan.merchantId ? snap.merchantById.get(plan.merchantId) : undefined;

      return {
        id: plan.id,
        cardId: plan.cardId,
        cardName: card?.name ?? "—",
        cardColor: card?.color ?? "#8b5cf6",
        description: plan.description,
        purchaseDate: plan.purchaseDate,
        totalAmountMinor: plan.totalAmountMinor,
        currency: plan.currency,
        installmentCount: plan.installmentCount,
        paidCount: rows.filter((i) => i.isPaid).length,
        categoryId: plan.categoryId,
        merchantName: merchant?.name ?? null,
        notes: plan.notes,
        status: plan.status,
        remainingMinor: unpaid.reduce((s, i) => s + i.amountMinor, 0),
        monthlyMinor: rows[0]?.amountMinor ?? 0,
        nextDueDate: unpaid[0]?.dueDate ?? null,
        lastDueDate: rows[rows.length - 1]?.dueDate ?? null,
        installments: rows.map((i) => ({
          id: i.id,
          seq: i.seq,
          amountMinor: i.amountMinor,
          dueDate: i.dueDate,
          isPaid: i.isPaid,
        })),
      };
    })
    .sort((a, b) => b.remainingMinor - a.remainingMinor);

  const currentMonth = monthKey(snap.ref);
  const totals = {
    remainingMinor: snap.installments
      .filter((i) => !i.isPaid)
      .reduce((s, i) => {
        const plan = snap.planById.get(i.planId);
        return s + toTRYOrZero(i.amountMinor, plan?.currency ?? "TRY", snap.rates);
      }, 0),
    thisMonthMinor: loads.find((l) => l.month === currentMonth)?.totalMinor ?? 0,
    activePlans: plans.filter((p) => p.status === "aktif").length,
  };

  return (
    <InstallmentsClient
      plans={plans}
      cards={snap.cards
        .filter((c) => c.isActive && c.statementDay != null && c.dueDay != null)
        .map((c) => ({ value: c.id, label: c.name }))}
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
