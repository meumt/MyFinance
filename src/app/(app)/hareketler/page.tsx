import { flattenCategories } from "@/lib/analytics";
import { categoryPath, loadSnapshot } from "@/lib/data";
import { addMonthsToKey, formatMonthTR, monthKey } from "@/lib/dates";
import { toTRYOrZero } from "@/lib/fx";
import { describeInstallment } from "@/lib/installments";
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

  /* Vadesi gelmiş taksitler hareket listesinde kendiliğinden görünür.
     Ayrı kayıt OLUŞTURULMAZ: taksitler zaten ekstre borcunun içinde, ikinci
     kez yazsaydık borç iki katına çıkardı. Burada yalnızca gösterilirler. */
  const installmentRows: TxView[] = [];
  for (const plan of snap.plans) {
    const card = snap.cardById.get(plan.cardId);
    if (!card || card.statementDay == null || card.dueDay == null) continue;
    if (source && sourceType === "kart" && plan.cardId !== sourceId) continue;
    if (source && sourceType === "hesap") continue;
    if (kind && kind !== "gider") continue;
    if (category && plan.categoryId !== Number(category)) continue;

    const planEntryDate = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Istanbul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(plan.createdAt));

    const cat = plan.categoryId ? snap.categoryById.get(plan.categoryId) : undefined;

    for (const row of snap.installments.filter((i) => i.planId === plan.id)) {
      const s = describeInstallment(row, {
        cycle: { statementDay: card.statementDay, dueDay: card.dueDay },
        planEntryDate,
        ref: snap.ref,
      });
      // Yalnızca ekstresi kesilmiş taksitler listelenir.
      /* Ölçüt ekstre dönemi DEĞİL, işlemin gerçekleşmiş olmasıdır. Açık
         dönemin içinde ama tarihi henüz gelmemiş bir taksit karta işlenmemiş
         demektir; hareket listesinde görünmemeli. */
      if (s.postedDate > snap.ref) continue;
      // Hareket listesinde taksit, karta işlendiği gün görünür.
      if (monthKey(s.postedDate) !== month) continue;

      installmentRows.push({
        id: -row.id, // negatif kimlik: düzenlenemez, türetilmiş satır
        date: s.postedDate,
        kind: "gider",
        amountMinor: row.amountMinor,
        currency: plan.currency,
        accountId: null,
        cardId: plan.cardId,
        counterAccountId: null,
        counterCardId: null,
        categoryId: plan.categoryId,
        merchantName: null,
        description: plan.description,
        note: null,
        sourceName: card.name,
        sourceColor: cat?.color ?? card.color,
        categoryName: cat ? categoryPath(cat, snap.categoryById) : null,
        title: `${plan.description} · ${s.seq}/${plan.installmentCount} taksit`,
        isInstallment: true,
      });
    }
  }

  const allRows = [...transactions, ...installmentRows].sort(
    (a, b) => b.date.localeCompare(a.date) || b.id - a.id,
  );

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
  /* Listede görünen taksitler ay toplamına da girmeli; aksi halde satırlar
     görünüp Gider kutusuna yansımıyor. Bunlar gerçek hareket kaydı olmadığı
     için mükerrer sayım riski yok. */
  for (const row of installmentRows) {
    monthTotals.expenseMinor += toTRYOrZero(row.amountMinor, row.currency, snap.rates);
  }
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
      transactions={allRows}
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
