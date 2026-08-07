import { loadSnapshot } from "@/lib/data";
import { toTRYOrZero } from "@/lib/fx";
import { CardsClient, type CardView } from "./cards-client";

export const metadata = { title: "Kartlar" };
export const dynamic = "force-dynamic";

export default async function CardsPage() {
  const snap = await loadSnapshot();

  const cards: CardView[] = snap.cards
    .map((card) => {
      const ledger = snap.ledgers.get(card.id);
      const institution = card.institutionId
        ? snap.institutionById.get(card.institutionId)
        : undefined;
      const parent = card.parentCardId
        ? snap.cardById.get(card.parentCardId)
        : undefined;
      const linkedAccount = card.linkedAccountId
        ? snap.accountById.get(card.linkedAccountId)
        : undefined;

      return {
        id: card.id,
        name: card.name,
        type: card.type,
        currency: card.currency,
        color: card.color,
        lastFour: card.lastFour,
        network: card.network,
        institutionId: card.institutionId,
        institutionName: institution?.name ?? null,
        parentCardId: card.parentCardId,
        parentCardName: parent?.name ?? null,
        sharesParentLimit: card.sharesParentLimit,
        creditLimitMinor: card.creditLimitMinor,
        cashAdvanceLimitMinor: card.cashAdvanceLimitMinor,
        statementDay: card.statementDay,
        dueDay: card.dueDay,
        linkedAccountId: card.linkedAccountId,
        linkedAccountName: linkedAccount?.name ?? null,
        autoPayMode: card.autoPayMode,
        openingDebtMinor: card.openingDebtMinor,
        isActive: card.isActive,
        notes: card.notes,

        currentDueMinor: ledger?.currentDueMinor ?? 0,
        openPeriodSpendMinor: ledger?.openPeriodSpendMinor ?? 0,
        remainingInstallmentsMinor: ledger?.remainingInstallmentsMinor ?? 0,
        totalDebtMinor: ledger?.totalDebtMinor ?? 0,
        availableLimitMinor: ledger?.availableLimitMinor ?? card.creditLimitMinor,
        utilizationRatio: ledger?.utilizationRatio ?? 0,
        nextDueDate: ledger?.nextDueDate ?? null,
        minimumDueMinor: ledger?.currentStatement?.minimumDueMinor ?? 0,
        virtualCards: snap.cards
          .filter((c) => c.parentCardId === card.id)
          .map((c) => ({ id: c.id, name: c.name, lastFour: c.lastFour })),
        missingRates: ledger?.missingRates ?? { currencies: [], count: 0 },
      };
    })
    .sort(
      (a, b) =>
        Number(b.isActive) - Number(a.isActive) || b.totalDebtMinor - a.totalDebtMinor,
    );

  /* Sanal kartlar ana kartın limitini paylaşıyorsa limit iki kez sayılmamalı. */
  const totals = snap.cards.reduce(
    (acc, card) => {
      if (!card.isActive) return acc;
      const ledger = snap.ledgers.get(card.id);
      if (!ledger) return acc;

      acc.debtMinor += toTRYOrZero(ledger.totalDebtMinor, card.currency, snap.rates);
      acc.dueMinor += toTRYOrZero(ledger.currentDueMinor, card.currency, snap.rates);

      const sharesLimit = card.parentCardId != null && card.sharesParentLimit;
      if (!sharesLimit) {
        acc.limitMinor += toTRYOrZero(
          card.creditLimitMinor,
          card.currency,
          snap.rates,
        );
      }
      return acc;
    },
    { debtMinor: 0, limitMinor: 0, dueMinor: 0 },
  );

  return (
    <CardsClient
      cards={cards}
      institutions={snap.institutions
        .filter((i) => i.isActive)
        .map((i) => ({ value: i.id, label: i.name }))}
      accounts={snap.accounts
        .filter((a) => a.isActive)
        .map((a) => ({ value: a.id, label: a.name }))}
      totals={totals}
    />
  );
}
