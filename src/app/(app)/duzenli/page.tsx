import { flattenCategories } from "@/lib/analytics";
import { loadSnapshot } from "@/lib/data";
import { daysBetween } from "@/lib/dates";
import { toTRYOrZero } from "@/lib/fx";
import { RecurringClient, type RecurringView } from "./recurring-client";

export const metadata = { title: "Düzenli gelir/gider" };
export const dynamic = "force-dynamic";

export default async function RecurringPage() {
  const snap = await loadSnapshot();

  const items: RecurringView[] = snap.recurring
    .map((item) => {
      const account = item.accountId ? snap.accountById.get(item.accountId) : undefined;
      const card = item.cardId ? snap.cardById.get(item.cardId) : undefined;

      return {
        id: item.id,
        name: item.name,
        kind: item.kind,
        amountMinor: item.amountMinor,
        currency: item.currency,
        cycle: item.cycle,
        dayOfMonth: item.dayOfMonth,
        accountId: item.accountId,
        cardId: item.cardId,
        categoryId: item.categoryId,
        startDate: item.startDate,
        endDate: item.endDate,
        nextDate: item.nextDate,
        autoPost: item.autoPost,
        isActive: item.isActive,
        notes: item.notes,
        targetLabel: account?.name ?? card?.name ?? "hedef yok",
        daysUntil: daysBetween(snap.ref, item.nextDate),
        amountTRYMinor: toTRYOrZero(item.amountMinor, item.currency, snap.rates),
      };
    })
    .sort(
      (a, b) =>
        Number(b.isActive) - Number(a.isActive) || a.nextDate.localeCompare(b.nextDate),
    );

  const totals = items
    .filter((i) => i.isActive)
    .reduce(
      (acc, item) => {
        // Yıllık ve haftalık kalemler aylık eşdeğere indirgenir.
        const monthly =
          item.cycle === "yillik"
            ? Math.round(item.amountTRYMinor / 12)
            : item.cycle === "haftalik"
              ? Math.round((item.amountTRYMinor * 52) / 12)
              : item.amountTRYMinor;

        if (item.kind === "gelir") acc.incomeMinor += monthly;
        else acc.expenseMinor += monthly;
        return acc;
      },
      { incomeMinor: 0, expenseMinor: 0 },
    );

  return (
    <RecurringClient
      items={items}
      accounts={snap.accounts
        .filter((a) => a.isActive)
        .map((a) => ({ value: a.id, label: a.name }))}
      cards={snap.cards.filter((c) => c.isActive).map((c) => ({ value: c.id, label: c.name }))}
      categories={flattenCategories(snap.categories)
        .filter((c) => c.isActive && c.kind !== "transfer")
        .map((c) => ({ value: c.id, label: c.label, group: c.kind === "gelir" ? "Gelir" : "Gider" }))}
      totals={totals}
    />
  );
}
