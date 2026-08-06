import { flattenCategories } from "@/lib/analytics";
import { categoryPath, loadSnapshot } from "@/lib/data";
import { addMonthsToKey, formatMonthTR, monthKey } from "@/lib/dates";
import { toTRYOrZero } from "@/lib/fx";
import { rowSignature } from "@/lib/parser";
import { TransactionsClient, type TxView } from "./transactions-client";

export const metadata = { title: "Hareketler" };
export const dynamic = "force-dynamic";

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const snap = await loadSnapshot();

  const currentMonth = monthKey(snap.ref);
  const month = params.ay && /^\d{4}-\d{2}$/.test(params.ay) ? params.ay : currentMonth;
  const source = params.kaynak ?? "";
  const kind = params.tur ?? "";
  const category = params.kategori ?? "";

  const [sourceType, sourceIdRaw] = source.split(":");
  const sourceId = Number(sourceIdRaw);

  const filtered = snap.transactions.filter((tx) => {
    if (monthKey(tx.date) !== month) return false;
    if (kind && tx.kind !== kind) return false;
    if (category && tx.categoryId !== Number(category)) return false;

    if (source && Number.isInteger(sourceId)) {
      if (sourceType === "kart") {
        if (tx.cardId !== sourceId && tx.counterCardId !== sourceId) return false;
      } else if (sourceType === "hesap") {
        if (tx.accountId !== sourceId && tx.counterAccountId !== sourceId) return false;
      }
    }
    return true;
  });

  const transactions: TxView[] = filtered.map((tx) => {
    const cat = tx.categoryId ? snap.categoryById.get(tx.categoryId) : undefined;
    const card = tx.cardId ? snap.cardById.get(tx.cardId) : undefined;
    const account = tx.accountId ? snap.accountById.get(tx.accountId) : undefined;
    const merchant = tx.merchantId ? snap.merchantById.get(tx.merchantId) : undefined;

    const title =
      tx.description ?? merchant?.name ?? (cat ? categoryPath(cat, snap.categoryById) : "Hareket");

    return {
      id: tx.id,
      date: tx.date,
      kind: tx.kind,
      amountMinor: tx.amountMinor,
      currency: tx.currency,
      accountId: tx.accountId,
      cardId: tx.cardId,
      counterAccountId: tx.counterAccountId,
      counterCardId: tx.counterCardId,
      categoryId: tx.categoryId,
      merchantName: merchant?.name ?? null,
      description: tx.description,
      note: tx.note,
      sourceName: card?.name ?? account?.name ?? "—",
      sourceColor: cat?.color ?? card?.color ?? account?.color ?? "#94a3b8",
      categoryName: cat ? categoryPath(cat, snap.categoryById) : null,
      title,
      isInstallment: tx.installmentPlanId != null,
    };
  });

  /* Ay toplamları — dövizli hareketler TL karşılığından toplanır. */
  const monthTotals = filtered.reduce(
    (acc, tx) => {
      if (tx.kind === "transfer" || tx.kind === "kart_odeme") return acc;
      const tl = toTRYOrZero(tx.amountMinor, tx.currency, snap.rates);
      if (tx.kind === "gelir") acc.incomeMinor += tl;
      else if (tx.kind === "iade") acc.expenseMinor -= tl;
      else acc.expenseMinor += tl;
      return acc;
    },
    { incomeMinor: 0, expenseMinor: 0, netMinor: 0 },
  );
  monthTotals.netMinor = monthTotals.incomeMinor - monthTotals.expenseMinor;

  /* Ay seçenekleri: verinin en eskisinden bu aya kadar + 1 ay ileri. */
  const oldest = snap.transactions.length > 0
    ? monthKey(snap.transactions[snap.transactions.length - 1].date)
    : currentMonth;

  const monthOptions: Array<{ value: string; label: string }> = [];
  let cursor = addMonthsToKey(currentMonth, 1);
  let guard = 0;
  while (cursor >= oldest && guard++ < 120) {
    monthOptions.push({ value: cursor, label: formatMonthTR(cursor) });
    cursor = addMonthsToKey(cursor, -1);
  }

  /* Toplu içe aktarmada tekrarı yakalamak için mevcut kayıtların imzaları. */
  const existingSignatures = snap.transactions.slice(0, 3000).map((tx) =>
    rowSignature({
      date: tx.date,
      amountMinor: tx.amountMinor,
      description:
        tx.description ??
        (tx.merchantId ? (snap.merchantById.get(tx.merchantId)?.name ?? "") : ""),
    }),
  );

  return (
    <TransactionsClient
      transactions={transactions}
      accounts={snap.accounts
        .filter((a) => a.isActive)
        .map((a) => ({ value: a.id, label: a.name }))}
      cards={snap.cards.filter((c) => c.isActive).map((c) => ({ value: c.id, label: c.name }))}
      categories={flattenCategories(snap.categories)
        .filter((c) => c.isActive)
        .map((c) => ({ value: c.id, label: c.label }))}
      months={monthOptions}
      filters={{ month, source, kind, category }}
      monthTotals={monthTotals}
      existingSignatures={existingSignatures}
    />
  );
}
