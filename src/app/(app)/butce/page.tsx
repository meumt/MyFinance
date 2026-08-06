import { flattenCategories, budgetStatus } from "@/lib/analytics";
import { loadSnapshot } from "@/lib/data";
import { monthKey } from "@/lib/dates";
import { BudgetsClient, type BudgetView } from "./budgets-client";

export const metadata = { title: "Bütçe" };
export const dynamic = "force-dynamic";

export default async function BudgetsPage() {
  const snap = await loadSnapshot();
  const month = monthKey(snap.ref);
  const statuses = budgetStatus(snap, month);

  const budgets: BudgetView[] = snap.budgets
    .filter((b) => b.month == null || b.month === month)
    .map((b) => {
      const status = statuses.find((s) => s.categoryId === b.categoryId);
      return {
        id: b.id,
        categoryId: b.categoryId,
        name: status?.name ?? "—",
        month: b.month,
        amountMinor: b.amountMinor,
        currency: b.currency,
        spentMinor: status?.spentMinor ?? 0,
        remainingMinor: status?.remainingMinor ?? b.amountMinor,
        ratio: status?.ratio ?? 0,
        isOver: status?.isOver ?? false,
      };
    })
    .sort((a, b) => b.ratio - a.ratio);

  return (
    <BudgetsClient
      budgets={budgets}
      month={month}
      categories={flattenCategories(snap.categories, "gider")
        .filter((c) => c.isActive)
        .map((c) => ({ value: c.id, label: c.label }))}
    />
  );
}
