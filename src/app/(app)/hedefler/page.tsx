import { loadSnapshot } from "@/lib/data";
import { daysBetween, monthsBetween } from "@/lib/dates";
import { toTRYOrZero } from "@/lib/fx";
import { monthlyTotals } from "@/lib/analytics";
import { GoalsClient, type GoalView } from "./goals-client";

export const metadata = { title: "Birikim hedefleri" };
export const dynamic = "force-dynamic";

export default async function GoalsPage() {
  const snap = await loadSnapshot();

  /* Aylık ortalama tasarruf — hedefe kalan süreyi tahmin etmek için. */
  const history = monthlyTotals(snap, 4).slice(0, -1);
  const withData = history.filter((m) => m.incomeMinor > 0);
  const avgMonthlySaving =
    withData.length > 0
      ? Math.round(withData.reduce((s, m) => s + m.netMinor, 0) / withData.length)
      : 0;

  const goals: GoalView[] = snap.goals
    .map((goal) => {
      /* Hesaba bağlıysa güncel bakiye, değilse elle girilen tutar. */
      const account = goal.accountId ? snap.accountById.get(goal.accountId) : undefined;
      const balance = goal.accountId ? snap.balances.get(goal.accountId) : undefined;
      const savedMinor =
        account && balance
          ? Math.max(0, balance.balanceMinor)
          : goal.manualSavedMinor;

      const savedTRY = toTRYOrZero(savedMinor, account?.currency ?? goal.currency, snap.rates);
      const targetTRY = toTRYOrZero(goal.targetMinor, goal.currency, snap.rates);
      const remaining = Math.max(0, targetTRY - savedTRY);

      const monthsAtCurrentRate =
        avgMonthlySaving > 0 && remaining > 0
          ? Math.ceil(remaining / avgMonthlySaving)
          : remaining <= 0
            ? 0
            : null;

      const monthsToTarget = goal.targetDate
        ? monthsBetween(snap.ref, goal.targetDate)
        : null;

      return {
        id: goal.id,
        name: goal.name,
        targetMinor: goal.targetMinor,
        currency: goal.currency,
        targetDate: goal.targetDate,
        accountId: goal.accountId,
        accountName: account?.name ?? null,
        manualSavedMinor: goal.manualSavedMinor,
        isActive: goal.isActive,
        color: goal.color,
        notes: goal.notes,
        savedMinor,
        savedTRYMinor: savedTRY,
        remainingMinor: remaining,
        ratio: targetTRY > 0 ? savedTRY / targetTRY : 0,
        monthsAtCurrentRate,
        monthsToTarget,
        daysToTarget: goal.targetDate ? daysBetween(snap.ref, goal.targetDate) : null,
        /** Hedef tarihe yetişmek için ayda gereken tutar. */
        requiredMonthlyMinor:
          goal.targetDate && monthsToTarget && monthsToTarget > 0
            ? Math.ceil(remaining / monthsToTarget)
            : null,
      };
    })
    .sort((a, b) => Number(b.isActive) - Number(a.isActive) || b.ratio - a.ratio);

  return (
    <GoalsClient
      goals={goals}
      accounts={snap.accounts
        .filter((a) => a.isActive)
        .map((a) => ({ value: a.id, label: a.name }))}
      avgMonthlySavingMinor={avgMonthlySaving}
    />
  );
}
