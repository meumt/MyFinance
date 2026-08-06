import { flattenCategories, monthlyEquivalent, subscriptionCosts } from "@/lib/analytics";
import { loadSnapshot } from "@/lib/data";
import { daysBetween } from "@/lib/dates";
import { toTRYOrZero } from "@/lib/fx";
import { SubscriptionsClient, type SubscriptionView } from "./subscriptions-client";

export const metadata = { title: "Abonelikler" };
export const dynamic = "force-dynamic";

export default async function SubscriptionsPage() {
  const snap = await loadSnapshot();
  const costs = subscriptionCosts(snap);

  const subscriptions: SubscriptionView[] = snap.subscriptions
    .map((sub) => {
      const card = sub.paymentCardId ? snap.cardById.get(sub.paymentCardId) : undefined;
      const account = sub.paymentAccountId
        ? snap.accountById.get(sub.paymentAccountId)
        : undefined;

      /* Kartla ödenen abonelikte limit yetiyor mu? */
      let limitWarning = false;
      if (sub.paymentCardId) {
        const ledger = snap.ledgers.get(sub.paymentCardId);
        const amountTL = toTRYOrZero(sub.amountMinor, sub.currency, snap.rates);
        limitWarning = !!ledger && ledger.availableLimitMinor < amountTL;
      }

      return {
        id: sub.id,
        name: sub.name,
        amountMinor: sub.amountMinor,
        currency: sub.currency,
        cycle: sub.cycle,
        cycleDays: sub.cycleDays,
        startDate: sub.startDate,
        nextRenewalDate: sub.nextRenewalDate,
        endDate: sub.endDate,
        lastChargedDate: sub.lastChargedDate,
        paymentCardId: sub.paymentCardId,
        paymentAccountId: sub.paymentAccountId,
        paymentLabel: card?.name ?? account?.name ?? "ödeme yöntemi yok",
        categoryId: sub.categoryId,
        autoRenew: sub.autoRenew,
        reminderDaysBefore: sub.reminderDaysBefore,
        isActive: sub.isActive,
        notes: sub.notes,
        monthlyEquivalentMinor: monthlyEquivalent(
          toTRYOrZero(sub.amountMinor, sub.currency, snap.rates),
          sub.cycle,
          sub.cycleDays,
        ),
        daysUntil: daysBetween(snap.ref, sub.nextRenewalDate),
        limitWarning,
      };
    })
    .sort(
      (a, b) =>
        Number(b.isActive) - Number(a.isActive) ||
        a.nextRenewalDate.localeCompare(b.nextRenewalDate),
    );

  return (
    <SubscriptionsClient
      subscriptions={subscriptions}
      cards={snap.cards.filter((c) => c.isActive).map((c) => ({ value: c.id, label: c.name }))}
      accounts={snap.accounts
        .filter((a) => a.isActive)
        .map((a) => ({ value: a.id, label: a.name }))}
      categories={flattenCategories(snap.categories, "gider")
        .filter((c) => c.isActive)
        .map((c) => ({ value: c.id, label: c.label }))}
      totals={{
        monthlyMinor: costs.monthlyEquivalentMinor,
        yearlyMinor: costs.yearlyMinor,
      }}
    />
  );
}
