import type { Category, Transaction } from "@/db/schema";
import { categoryPath, type FinancialSnapshot } from "./data";
import {
  addMonthsToKey,
  daysBetween,
  monthEnd,
  monthKey,
  monthRange,
  monthStart,
} from "./dates";
import { toTRYOrZero } from "./fx";

/**
 * Raporlama hesapları. Tüm tutarlar TL karşılığına çevrilerek toplanır;
 * dövizli hesaplar güncel kurdan değerlenir.
 */

/* ─────────────────────────── Aylık gelir / gider ─────────────────────────── */

export interface MonthlyTotals {
  month: string;
  incomeMinor: number;
  expenseMinor: number;
  netMinor: number;
  /** Tasarruf oranı: (gelir − gider) / gelir */
  savingsRate: number;
  /** Kaçınılmaz (zorunlu) giderler. */
  essentialMinor: number;
  discretionaryMinor: number;
}

/** Bir hareketin gelir/gider açısından TL tutarı; transferler sayılmaz. */
function txFlow(
  tx: Transaction,
  snap: FinancialSnapshot,
): { income: number; expense: number } {
  const zero = { income: 0, expense: 0 };
  // Transfer ve kart ödemesi para akışı değil, yer değiştirmedir.
  if (tx.kind === "transfer" || tx.kind === "kart_odeme") return zero;

  const tl = toTRYOrZero(tx.amountMinor, tx.currency, snap.rates);
  switch (tx.kind) {
    case "gelir":
      return { income: tl, expense: 0 };
    case "iade":
      // İade gideri azaltır, gelir sayılmaz.
      return { income: 0, expense: -tl };
    case "gider":
    case "faiz":
    case "ucret":
      return { income: 0, expense: tl };
    default:
      return zero;
  }
}

function isEssential(tx: Transaction, snap: FinancialSnapshot): boolean {
  if (tx.categoryId == null) return false;
  return snap.categoryById.get(tx.categoryId)?.isEssential ?? false;
}

export function monthlyTotals(
  snap: FinancialSnapshot,
  months = 12,
): MonthlyTotals[] {
  const endMonth = monthKey(snap.ref);
  const startMonth = addMonthsToKey(endMonth, -(months - 1));
  const buckets = new Map<string, MonthlyTotals>();

  for (const m of monthRange(startMonth, endMonth)) {
    buckets.set(m, {
      month: m,
      incomeMinor: 0,
      expenseMinor: 0,
      netMinor: 0,
      savingsRate: 0,
      essentialMinor: 0,
      discretionaryMinor: 0,
    });
  }

  for (const tx of snap.transactions) {
    const m = monthKey(tx.date);
    const bucket = buckets.get(m);
    if (!bucket) continue;

    const { income, expense } = txFlow(tx, snap);
    bucket.incomeMinor += income;
    bucket.expenseMinor += expense;
    if (expense !== 0) {
      if (isEssential(tx, snap)) bucket.essentialMinor += expense;
      else bucket.discretionaryMinor += expense;
    }
  }

  for (const bucket of buckets.values()) {
    bucket.netMinor = bucket.incomeMinor - bucket.expenseMinor;
    bucket.savingsRate =
      bucket.incomeMinor > 0 ? bucket.netMinor / bucket.incomeMinor : 0;
  }

  return [...buckets.values()].sort((a, b) => a.month.localeCompare(b.month));
}

/* ──────────────────────────── Kategori kırılımı ──────────────────────────── */

export interface CategorySlice {
  categoryId: number | null;
  name: string;
  color: string;
  amountMinor: number;
  previousMinor: number;
  /** Önceki aya göre değişim oranı; önceki ay 0 ise null. */
  changeRatio: number | null;
  ratio: number;
  txCount: number;
}

/**
 * Belirtilen ayın gider dağılımı. Alt kategoriler üst kategoride toplanır,
 * böylece grafik okunabilir kalır.
 */
export function categoryBreakdown(
  snap: FinancialSnapshot,
  month: string = monthKey(snap.ref),
  options: { rollUpToParent?: boolean } = {},
): CategorySlice[] {
  const rollUp = options.rollUpToParent ?? true;
  const prevMonth = addMonthsToKey(month, -1);

  const current = new Map<number | null, { amount: number; count: number }>();
  const previous = new Map<number | null, number>();

  const resolveKey = (categoryId: number | null): number | null => {
    if (categoryId == null) return null;
    const cat = snap.categoryById.get(categoryId);
    if (!cat) return null;
    if (rollUp && cat.parentId) return cat.parentId;
    return cat.id;
  };

  for (const tx of snap.transactions) {
    const { expense } = txFlow(tx, snap);
    if (expense === 0) continue;

    const m = monthKey(tx.date);
    const key = resolveKey(tx.categoryId);

    if (m === month) {
      const entry = current.get(key) ?? { amount: 0, count: 0 };
      entry.amount += expense;
      entry.count += 1;
      current.set(key, entry);
    } else if (m === prevMonth) {
      previous.set(key, (previous.get(key) ?? 0) + expense);
    }
  }

  const total = [...current.values()].reduce((s, e) => s + e.amount, 0);

  const slices: CategorySlice[] = [...current.entries()].map(([key, entry]) => {
    const cat = key != null ? snap.categoryById.get(key) : undefined;
    const prev = previous.get(key) ?? 0;
    return {
      categoryId: key,
      name: cat ? categoryPath(cat, snap.categoryById) : "Kategorisiz",
      color: cat?.color ?? "#94a3b8",
      amountMinor: entry.amount,
      previousMinor: prev,
      changeRatio: prev > 0 ? (entry.amount - prev) / prev : null,
      ratio: total > 0 ? entry.amount / total : 0,
      txCount: entry.count,
    };
  });

  return slices.sort((a, b) => b.amountMinor - a.amountMinor);
}

/* ───────────────────────────── En çok harcanan ───────────────────────────── */

export interface MerchantSlice {
  merchantId: number | null;
  name: string;
  amountMinor: number;
  txCount: number;
}

export function topMerchants(
  snap: FinancialSnapshot,
  month: string = monthKey(snap.ref),
  limit = 10,
): MerchantSlice[] {
  const map = new Map<number | null, { amount: number; count: number }>();

  for (const tx of snap.transactions) {
    if (monthKey(tx.date) !== month) continue;
    const { expense } = txFlow(tx, snap);
    if (expense <= 0) continue;

    const key = tx.merchantId ?? null;
    const entry = map.get(key) ?? { amount: 0, count: 0 };
    entry.amount += expense;
    entry.count += 1;
    map.set(key, entry);
  }

  return [...map.entries()]
    .map(([id, e]) => ({
      merchantId: id,
      name: id != null ? (snap.merchantById.get(id)?.name ?? "—") : "Belirtilmemiş",
      amountMinor: e.amount,
      txCount: e.count,
    }))
    .sort((a, b) => b.amountMinor - a.amountMinor)
    .slice(0, limit);
}

/* ────────────────────────── Ay sonu harcama tahmini ─────────────────────── */

export interface BurnRate {
  month: string;
  spentSoFarMinor: number;
  daysElapsed: number;
  daysInMonth: number;
  dailyAverageMinor: number;
  /** Mevcut tempoyla ay sonunda ulaşılacak tahmini gider. */
  projectedMonthEndMinor: number;
  /** Geçen ayın aynı gününe kıyasla fark oranı. */
  vsPreviousRatio: number | null;
}

export function burnRate(snap: FinancialSnapshot): BurnRate {
  const month = monthKey(snap.ref);
  const start = monthStart(month);
  const end = monthEnd(month);
  const daysInMonth = daysBetween(start, end) + 1;
  const daysElapsed = daysBetween(start, snap.ref) + 1;

  let spent = 0;
  let prevSameWindow = 0;
  const prevMonth = addMonthsToKey(month, -1);
  const prevCutoffDay = Math.min(daysElapsed, daysBetween(monthStart(prevMonth), monthEnd(prevMonth)) + 1);

  for (const tx of snap.transactions) {
    const { expense } = txFlow(tx, snap);
    if (expense === 0) continue;
    const m = monthKey(tx.date);

    if (m === month && tx.date <= snap.ref) {
      spent += expense;
    } else if (m === prevMonth) {
      const dayIndex = daysBetween(monthStart(prevMonth), tx.date) + 1;
      if (dayIndex <= prevCutoffDay) prevSameWindow += expense;
    }
  }

  const dailyAverage = daysElapsed > 0 ? Math.round(spent / daysElapsed) : 0;

  return {
    month,
    spentSoFarMinor: spent,
    daysElapsed,
    daysInMonth,
    dailyAverageMinor: dailyAverage,
    projectedMonthEndMinor: dailyAverage * daysInMonth,
    vsPreviousRatio:
      prevSameWindow > 0 ? (spent - prevSameWindow) / prevSameWindow : null,
  };
}

/* ─────────────────────────────── Abonelikler ─────────────────────────────── */

export interface SubscriptionCost {
  monthlyEquivalentMinor: number;
  yearlyMinor: number;
  activeCount: number;
  /** En pahalıdan ucuza sıralı liste. */
  items: Array<{
    id: number;
    name: string;
    monthlyEquivalentMinor: number;
    amountMinor: number;
    currency: string;
    cycle: string;
    nextRenewalDate: string;
  }>;
}

/** Farklı periyotlardaki abonelikleri aylık eşdeğere indirger. */
export function monthlyEquivalent(
  amountMinor: number,
  cycle: string,
  cycleDays?: number | null,
): number {
  switch (cycle) {
    case "haftalik":
      return Math.round((amountMinor * 52) / 12);
    case "aylik":
      return amountMinor;
    case "uc_aylik":
      return Math.round(amountMinor / 3);
    case "alti_aylik":
      return Math.round(amountMinor / 6);
    case "yillik":
      return Math.round(amountMinor / 12);
    case "ozel":
      return cycleDays && cycleDays > 0
        ? Math.round((amountMinor * 365) / (cycleDays * 12))
        : amountMinor;
    default:
      return amountMinor;
  }
}

export function subscriptionCosts(snap: FinancialSnapshot): SubscriptionCost {
  const active = snap.subscriptions.filter((s) => s.isActive);

  const items = active
    .map((s) => {
      const tl = toTRYOrZero(s.amountMinor, s.currency, snap.rates);
      return {
        id: s.id,
        name: s.name,
        monthlyEquivalentMinor: monthlyEquivalent(tl, s.cycle, s.cycleDays),
        amountMinor: s.amountMinor,
        currency: s.currency,
        cycle: s.cycle,
        nextRenewalDate: s.nextRenewalDate,
      };
    })
    .sort((a, b) => b.monthlyEquivalentMinor - a.monthlyEquivalentMinor);

  const monthly = items.reduce((s, i) => s + i.monthlyEquivalentMinor, 0);

  return {
    monthlyEquivalentMinor: monthly,
    yearlyMinor: monthly * 12,
    activeCount: active.length,
    items,
  };
}

/* ──────────────────────────────── Net değer ──────────────────────────────── */

export interface NetWorth {
  /** Nakit ve mevduat toplamı (TL karşılığı). */
  liquidMinor: number;
  /** Kart borçları + krediler + ek hesap kullanımı. */
  debtMinor: number;
  cardDebtMinor: number;
  loanDebtMinor: number;
  overdraftMinor: number;
  netMinor: number;
  /** Ek hesap dahil harcanabilir tutar. */
  spendableMinor: number;
}

export function netWorth(snap: FinancialSnapshot): NetWorth {
  let liquid = 0;
  let overdraft = 0;
  let spendable = 0;

  for (const account of snap.accounts) {
    if (!account.isActive || account.excludeFromNetWorth) continue;
    const bal = snap.balances.get(account.id);
    if (!bal) continue;

    const tl = toTRYOrZero(bal.balanceMinor, account.currency, snap.rates);
    if (tl >= 0) liquid += tl;
    else overdraft += -tl;

    spendable += toTRYOrZero(bal.spendableMinor, account.currency, snap.rates);
  }

  let cardDebt = 0;
  for (const card of snap.cards) {
    if (!card.isActive) continue;
    // Sanal kartın borcu ana kartın defterinde zaten yer alıyorsa iki kez sayma.
    const ledger = snap.ledgers.get(card.id);
    if (!ledger) continue;
    cardDebt += toTRYOrZero(ledger.totalDebtMinor, card.currency, snap.rates);
  }

  let loanDebt = 0;
  for (const loan of snap.loans) {
    if (loan.status !== "aktif") continue;
    const remaining = snap.loanPayments
      .filter((p) => p.loanId === loan.id && !p.isPaid)
      .reduce((s, p) => s + p.amountMinor, 0);
    loanDebt += toTRYOrZero(remaining, loan.currency, snap.rates);
  }

  const debt = cardDebt + loanDebt + overdraft;

  return {
    liquidMinor: liquid,
    debtMinor: debt,
    cardDebtMinor: cardDebt,
    loanDebtMinor: loanDebt,
    overdraftMinor: overdraft,
    netMinor: liquid - debt,
    spendableMinor: spendable,
  };
}

/* ──────────────────────── Gelecek aylara taksit yükü ─────────────────────── */

export interface InstallmentLoadMonth {
  month: string;
  totalMinor: number;
  /** Kart bazında kırılım. */
  byCard: Array<{ cardId: number; cardName: string; amountMinor: number }>;
  planCount: number;
}

/**
 * Türkiye'de en kritik gösterge: bugün yapılan taksitli alışverişin
 * önümüzdeki aylara bindirdiği sabit yük.
 */
export function installmentLoad(
  snap: FinancialSnapshot,
  months = 18,
): InstallmentLoadMonth[] {
  const startMonth = monthKey(snap.ref);
  const endMonth = addMonthsToKey(startMonth, months - 1);

  const buckets = new Map<string, Map<number, number>>();
  const planSets = new Map<string, Set<number>>();
  for (const m of monthRange(startMonth, endMonth)) {
    buckets.set(m, new Map());
    planSets.set(m, new Set());
  }

  for (const inst of snap.installments) {
    if (inst.isPaid) continue;
    const m = monthKey(inst.dueDate);
    const bucket = buckets.get(m);
    if (!bucket) continue;

    const plan = snap.planById.get(inst.planId);
    if (!plan) continue;

    const tl = toTRYOrZero(inst.amountMinor, plan.currency, snap.rates);
    bucket.set(plan.cardId, (bucket.get(plan.cardId) ?? 0) + tl);
    planSets.get(m)!.add(plan.id);
  }

  return monthRange(startMonth, endMonth).map((m) => {
    const bucket = buckets.get(m)!;
    const byCard = [...bucket.entries()]
      .map(([cardId, amountMinor]) => ({
        cardId,
        cardName: snap.cardById.get(cardId)?.name ?? "—",
        amountMinor,
      }))
      .sort((a, b) => b.amountMinor - a.amountMinor);

    return {
      month: m,
      totalMinor: byCard.reduce((s, c) => s + c.amountMinor, 0),
      byCard,
      planCount: planSets.get(m)!.size,
    };
  });
}

/** Son taksitin bittiği tarih — "ne zaman rahatlarım" sorusunun net cevabı. */
export function installmentFreeDate(snap: FinancialSnapshot): string | null {
  const unpaid = snap.installments.filter((i) => !i.isPaid && i.dueDate >= snap.ref);
  if (unpaid.length === 0) return null;
  return unpaid.reduce((a, i) => (i.dueDate > a ? i.dueDate : a), unpaid[0].dueDate);
}

/* ─────────────────────────────── Bütçe durumu ────────────────────────────── */

export interface BudgetStatus {
  categoryId: number;
  name: string;
  color: string;
  budgetMinor: number;
  spentMinor: number;
  remainingMinor: number;
  ratio: number;
  isOver: boolean;
}

export function budgetStatus(
  snap: FinancialSnapshot,
  month: string = monthKey(snap.ref),
): BudgetStatus[] {
  const spentByCategory = new Map<number, number>();

  for (const tx of snap.transactions) {
    if (monthKey(tx.date) !== month) continue;
    const { expense } = txFlow(tx, snap);
    if (expense === 0 || tx.categoryId == null) continue;

    // Bütçe üst kategoriye konmuşsa alt kategori harcamaları da sayılır.
    const cat = snap.categoryById.get(tx.categoryId);
    if (!cat) continue;
    spentByCategory.set(cat.id, (spentByCategory.get(cat.id) ?? 0) + expense);
    if (cat.parentId) {
      spentByCategory.set(
        cat.parentId,
        (spentByCategory.get(cat.parentId) ?? 0) + expense,
      );
    }
  }

  return snap.budgets
    .filter((b) => b.month == null || b.month === month)
    .map((b) => {
      const cat = snap.categoryById.get(b.categoryId);
      const spent = spentByCategory.get(b.categoryId) ?? 0;
      return {
        categoryId: b.categoryId,
        name: cat ? categoryPath(cat, snap.categoryById) : "—",
        color: cat?.color ?? "#94a3b8",
        budgetMinor: b.amountMinor,
        spentMinor: spent,
        remainingMinor: b.amountMinor - spent,
        ratio: b.amountMinor > 0 ? spent / b.amountMinor : 0,
        isOver: spent > b.amountMinor,
      };
    })
    .sort((a, b) => b.ratio - a.ratio);
}

/** Kategori listesini üst/alt ilişkisiyle düz sıralı hale getirir (seçim kutuları için). */
export function flattenCategories(
  categories: Category[],
  kind?: string,
): Array<Category & { depth: number; label: string }> {
  const filtered = kind ? categories.filter((c) => c.kind === kind) : categories;
  const roots = filtered
    .filter((c) => !c.parentId)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "tr"));

  const out: Array<Category & { depth: number; label: string }> = [];
  for (const root of roots) {
    out.push({ ...root, depth: 0, label: root.name });
    const children = filtered
      .filter((c) => c.parentId === root.id)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "tr"));
    for (const child of children) {
      out.push({ ...child, depth: 1, label: `${root.name} › ${child.name}` });
    }
  }
  return out;
}
