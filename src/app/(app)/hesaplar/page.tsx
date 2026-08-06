import { desc } from "drizzle-orm";

import { db } from "@/db";
import { balanceSnapshots } from "@/db/schema";
import { loadSnapshot } from "@/lib/data";
import { toTRYOrZero } from "@/lib/fx";
import { AccountsClient, type AccountView } from "./accounts-client";

export const metadata = { title: "Hesaplar" };
export const dynamic = "force-dynamic";

export default async function AccountsPage() {
  const snap = await loadSnapshot();

  const snapshots = await db
    .select()
    .from(balanceSnapshots)
    .orderBy(desc(balanceSnapshots.date));

  const latestByAccount = new Map<number, string>();
  for (const s of snapshots) {
    if (!latestByAccount.has(s.accountId)) latestByAccount.set(s.accountId, s.date);
  }

  const accounts: AccountView[] = snap.accounts
    .map((account) => {
      const balance = snap.balances.get(account.id);
      const institution = account.institutionId
        ? snap.institutionById.get(account.institutionId)
        : undefined;

      return {
        id: account.id,
        name: account.name,
        type: account.type,
        currency: account.currency,
        color: account.color,
        iban: account.iban,
        institutionId: account.institutionId,
        institutionName: institution?.name ?? null,
        openingBalanceMinor: account.openingBalanceMinor,
        openingDate: account.openingDate,
        overdraftLimitMinor: account.overdraftLimitMinor,
        overdraftRateBps: account.overdraftRateBps,
        interestRateBps: account.interestRateBps,
        maturityDate: account.maturityDate,
        isActive: account.isActive,
        excludeFromNetWorth: account.excludeFromNetWorth,
        notes: account.notes,

        balanceMinor: balance?.balanceMinor ?? 0,
        overdraftUsedMinor: balance?.overdraftUsedMinor ?? 0,
        overdraftAvailableMinor: balance?.overdraftAvailableMinor ?? 0,
        spendableMinor: balance?.spendableMinor ?? 0,
        balanceTRYMinor: toTRYOrZero(
          balance?.balanceMinor ?? 0,
          account.currency,
          snap.rates,
        ),
        lastSnapshotDate: latestByAccount.get(account.id) ?? null,
      };
    })
    .sort((a, b) => Number(b.isActive) - Number(a.isActive) || b.balanceTRYMinor - a.balanceTRYMinor);

  const totalTRY = accounts
    .filter((a) => a.isActive && !a.excludeFromNetWorth && a.balanceTRYMinor > 0)
    .reduce((s, a) => s + a.balanceTRYMinor, 0);

  const totalOverdraft = accounts
    .filter((a) => a.isActive)
    .reduce(
      (s, a) =>
        s +
        toTRYOrZero(
          a.overdraftUsedMinor,
          snap.accountById.get(a.id)?.currency ?? "TRY",
          snap.rates,
        ),
      0,
    );

  return (
    <AccountsClient
      accounts={accounts}
      institutions={snap.institutions
        .filter((i) => i.isActive)
        .map((i) => ({ value: i.id, label: i.name }))}
      totalTRYMinor={totalTRY}
      totalOverdraftMinor={totalOverdraft}
    />
  );
}
