import type { Account, Card, Installment, Transaction } from "@/db/schema";
import { addMonthsToKey, ISODate, monthKey, today } from "./dates";
import {
  buildPeriod,
  type CardCycle,
  DEFAULT_MINIMUM_POLICY,
  deriveStatementStatus,
  minimumPaymentMinor,
  type MinimumPaymentPolicy,
  type StatementPeriod,
  type StatementStatus,
} from "./statements";

/**
 * Bakiye ve borç hesaplamalarının tamamı burada.
 * Saf fonksiyonlardır: veritabanına dokunmaz, test edilebilir.
 */

/* ─────────────────────── Hareketin yön etkisi ─────────────────────── */

/**
 * Bir hareketin belirli bir HESAP bakiyesine etkisi (kuruş, işaretli).
 * Tutarlar veritabanında hep pozitiftir; yönü `kind` belirler.
 */
export function accountDelta(tx: Transaction, accountId: number): number {
  const amt = tx.amountMinor;

  if (tx.kind === "transfer") {
    if (tx.accountId === accountId) return -amt; // gönderen
    if (tx.counterAccountId === accountId) return amt; // alan
    return 0;
  }

  if (tx.accountId !== accountId) return 0;

  switch (tx.kind) {
    case "gelir":
    case "iade":
      return amt;
    case "gider":
    case "faiz":
    case "ucret":
    case "kart_odeme":
      return -amt;
    default:
      return 0;
  }
}

/** Bir hareketin KART borcuna etkisi (kuruş, pozitif = borç artışı). */
export function cardDebtDelta(tx: Transaction, cardId: number): number {
  const amt = tx.amountMinor;

  // Kart ödemesi borcu azaltır; ödenen kart counterCardId'dir.
  if (tx.kind === "kart_odeme" && tx.counterCardId === cardId) return -amt;

  if (tx.cardId !== cardId) return 0;

  switch (tx.kind) {
    case "gider":
    case "faiz":
    case "ucret":
      return amt;
    case "iade":
    case "gelir":
      return -amt;
    default:
      return 0;
  }
}

/* ───────────────────────────── Hesap bakiyesi ───────────────────────────── */

export interface AccountBalance {
  accountId: number;
  /** Güncel bakiye — eksi ise ek hesap (KMH) kullanımı vardır. */
  balanceMinor: number;
  /** Kullanılan ek hesap tutarı (bakiye eksideyse). */
  overdraftUsedMinor: number;
  /** Ek hesaptan kalan kullanılabilir tutar. */
  overdraftAvailableMinor: number;
  /** Harcanabilir toplam = bakiye + kalan ek hesap limiti. */
  spendableMinor: number;
  /** Hesaplamanın dayandığı taban (son mutabakat ya da açılış). */
  baseDate: ISODate;
}

export interface BalanceBase {
  date: ISODate;
  balanceMinor: number;
}

/**
 * Hesap bakiyesi = taban bakiye + tabandan SONRAKİ hareketlerin etkisi.
 * Taban, varsa en güncel bakiye mutabakatı, yoksa açılış bakiyesidir.
 */
export function computeAccountBalance(
  account: Account,
  transactions: Transaction[],
  latestSnapshot?: BalanceBase | null,
): AccountBalance {
  const base =
    latestSnapshot && latestSnapshot.date >= account.openingDate
      ? latestSnapshot
      : { date: account.openingDate, balanceMinor: account.openingBalanceMinor };

  let balance = base.balanceMinor;
  for (const tx of transactions) {
    // Mutabakat "gün sonu" anlamına gelir; o günün hareketleri zaten içindedir.
    if (tx.date <= base.date) continue;
    balance += accountDelta(tx, account.id);
  }

  const overdraftUsed = balance < 0 ? -balance : 0;
  const overdraftAvailable = Math.max(
    0,
    account.overdraftLimitMinor - overdraftUsed,
  );

  return {
    accountId: account.id,
    balanceMinor: balance,
    overdraftUsedMinor: overdraftUsed,
    overdraftAvailableMinor: overdraftAvailable,
    spendableMinor: balance + overdraftAvailable,
    baseDate: base.date,
  };
}

/* ────────────────────────────── Kart defteri ────────────────────────────── */

export interface CardPeriodLedger {
  period: StatementPeriod;
  /** Önceki dönemden devreden ödenmemiş borç. */
  carryInMinor: number;
  /** Dönem içi normal harcama (taksitler hariç). */
  chargesMinor: number;
  /** Bu döneme düşen taksit tutarları. */
  installmentsMinor: number;
  /** Faiz ve ücretler. */
  feesMinor: number;
  refundsMinor: number;
  /** Dönem borcu = devreden + harcama + taksit + ücret − iade. */
  totalDueMinor: number;
  minimumDueMinor: number;
  /** Bu dönemin son ödeme tarihine kadar yapılan ödemeler. */
  paymentsMinor: number;
  /** Sonraki döneme devreden. */
  carryOutMinor: number;
  status: StatementStatus;
  isClosed: boolean;
  isCurrent: boolean;
}

export interface CardLedger {
  cardId: number;
  periods: CardPeriodLedger[];
  /** Kesilmiş ve henüz tamamı ödenmemiş en güncel dönem. */
  currentStatement: CardPeriodLedger | null;
  /** Henüz kesilmemiş, birikmekte olan dönem. */
  openPeriod: CardPeriodLedger | null;
  /** Ödenmesi gereken güncel dönem borcu. */
  currentDueMinor: number;
  /** Açık dönemde şu ana kadar biriken harcama. */
  openPeriodSpendMinor: number;
  /** Ödenmemiş tüm taksitlerin toplamı (gelecek dönemler dahil). */
  remainingInstallmentsMinor: number;
  /** Kartın toplam yükü: güncel dönem borcu + açık dönem + gelecek taksitler. */
  totalDebtMinor: number;
  /** Kullanılabilir limit. */
  availableLimitMinor: number;
  utilizationRatio: number;
  nextDueDate: ISODate | null;
}

export interface CardLedgerInput {
  card: Card;
  /** Karta ait tüm hareketler + karta yapılan ödemeler. */
  transactions: Transaction[];
  /** Karta bağlı planların taksitleri. */
  installments: Installment[];
  policy?: MinimumPaymentPolicy;
  ref?: ISODate;
  /** Kaç dönem ileri hesaplansın. */
  futurePeriods?: number;
}

export function hasStatementCycle(card: Card): card is Card & CardCycle {
  return (
    card.type !== "banka" &&
    card.statementDay != null &&
    card.dueDay != null
  );
}

/**
 * Kartın dönem dönem borç defterini kurar.
 *
 * Taksitli alışverişler için hareket kaydı OLUŞTURULMAZ; kaynak `installments`
 * tablosudur. Böylece bir alışverişin tamamı yerine yalnızca o döneme düşen
 * taksit dönem borcuna girer.
 */
export function computeCardLedger(input: CardLedgerInput): CardLedger {
  const { card, transactions, installments } = input;
  const ref = input.ref ?? today();
  const policy = input.policy ?? DEFAULT_MINIMUM_POLICY;
  const futureCount = input.futurePeriods ?? 24;

  if (!hasStatementCycle(card)) {
    return emptyLedger(card);
  }

  const cycle: CardCycle = {
    statementDay: card.statementDay!,
    dueDay: card.dueDay!,
  };

  /* Hesaplama aralığı: en erken hareketten gelecekteki son taksite kadar. */
  const cardCreatedMonth = monthKey(
    new Date(card.createdAt).toISOString().slice(0, 10),
  );
  const activityMonths = [
    cardCreatedMonth,
    ...transactions.map((t) => monthKey(t.date)),
    ...installments.map((i) => monthKey(i.dueDate)),
  ];
  const startMonth = activityMonths.reduce((a, b) => (a < b ? a : b));
  const lastInstallmentMonth = installments.reduce(
    (a, i) => (monthKey(i.dueDate) > a ? monthKey(i.dueDate) : a),
    monthKey(ref),
  );
  const endMonth = maxMonth(
    addMonthsToKey(monthKey(ref), futureCount),
    lastInstallmentMonth,
  );

  /* Dönemleri kur. */
  const periods: StatementPeriod[] = [];
  let cursor = startMonth;
  let guard = 0;
  while (cursor <= endMonth && guard++ < 600) {
    periods.push(buildPeriod(cursor, cycle));
    cursor = addMonthsToKey(cursor, 1);
  }

  /* Ödemeleri son ödeme tarihine göre kovala: bir ödeme, tarihinden sonraki
     ilk son ödeme gününe ait ekstreyi kapatır. */
  const payments = transactions.filter(
    (t) => t.kind === "kart_odeme" && t.counterCardId === card.id,
  );
  const paymentBuckets = new Map<string, number>();
  for (const p of payments) {
    const target =
      periods.find((per) => per.dueDate >= p.date) ?? periods[periods.length - 1];
    if (!target) continue;
    paymentBuckets.set(
      target.monthKey,
      (paymentBuckets.get(target.monthKey) ?? 0) + p.amountMinor,
    );
  }

  /* Dönem dönem yürü. */
  const result: CardPeriodLedger[] = [];
  let carry = card.openingDebtMinor;

  for (const period of periods) {
    let charges = 0;
    let fees = 0;
    let refunds = 0;

    for (const tx of transactions) {
      if (tx.cardId !== card.id) continue;
      // Taksitli hareketler installments tablosundan sayılır, iki kez eklenmesin.
      if (tx.installmentPlanId != null) continue;
      if (tx.date < period.periodStart || tx.date > period.periodEnd) continue;

      if (tx.kind === "gider") charges += tx.amountMinor;
      else if (tx.kind === "faiz" || tx.kind === "ucret") fees += tx.amountMinor;
      else if (tx.kind === "iade" || tx.kind === "gelir")
        refunds += tx.amountMinor;
    }

    let installmentSum = 0;
    for (const inst of installments) {
      if (inst.dueDate < period.periodStart || inst.dueDate > period.periodEnd)
        continue;
      installmentSum += inst.amountMinor;
    }

    const totalDue = carry + charges + installmentSum + fees - refunds;
    const paid = paymentBuckets.get(period.monthKey) ?? 0;
    const carryOut = totalDue - paid;

    const isClosed = period.statementDate < ref;
    const isCurrent = !isClosed && period.periodStart <= ref;

    result.push({
      period,
      carryInMinor: carry,
      chargesMinor: charges,
      installmentsMinor: installmentSum,
      feesMinor: fees,
      refundsMinor: refunds,
      totalDueMinor: totalDue,
      minimumDueMinor: minimumPaymentMinor(totalDue, card.creditLimitMinor, {
        policy,
      }),
      paymentsMinor: paid,
      carryOutMinor: carryOut,
      status: deriveStatementStatus({
        statementDate: period.statementDate,
        dueDate: period.dueDate,
        totalDueMinor: totalDue,
        paidMinor: paid,
        ref,
      }),
      isClosed,
      isCurrent,
    });

    carry = carryOut;
  }

  /* Özet göstergeler. */
  const closed = result.filter((p) => p.isClosed);

  /* Devreden bakiye dönemler boyunca ileri taşındığı için ödenmemiş borcun
     tamamı EN SON kapanan dönemin kalanında toplanır. Daha eski bir dönemin
     kalanına bakmak, sonradan yapılan ödemeleri yok saymak olur. */
  const currentStatement = closed[closed.length - 1] ?? null;
  const openPeriod = result.find((p) => p.isCurrent) ?? null;

  // Fazla ödeme yapılmışsa kalan eksiye düşer; borç negatif olamaz.
  const currentDue = currentStatement
    ? Math.max(0, currentStatement.carryOutMinor)
    : 0;

  /* Açık dönemde biriken harcama. Taksitler buraya DAHİL EDİLMEZ; onlar
     `remainingInstallments` içinde bütün olarak sayılır, aksi halde açık
     döneme düşen taksit iki kez toplanır. */
  const openSpend = openPeriod
    ? openPeriod.chargesMinor + openPeriod.feesMinor - openPeriod.refundsMinor
    : 0;

  /* Henüz kesilmemiş dönemlere düşen tüm taksitler. Vadesi bugün olan taksit
     de dahildir — o dönem henüz kapanmamıştır. */
  const remainingInstallments = installments
    .filter((i) => !i.isPaid && i.dueDate >= ref)
    .reduce((sum, i) => sum + i.amountMinor, 0);

  const totalDebt = currentDue + openSpend + remainingInstallments;
  const available = Math.max(0, card.creditLimitMinor - totalDebt);

  return {
    cardId: card.id,
    periods: result,
    currentStatement,
    openPeriod,
    currentDueMinor: currentDue,
    openPeriodSpendMinor: openSpend,
    remainingInstallmentsMinor: remainingInstallments,
    totalDebtMinor: totalDebt,
    availableLimitMinor: available,
    utilizationRatio:
      card.creditLimitMinor > 0 ? totalDebt / card.creditLimitMinor : 0,
    nextDueDate:
      currentStatement && currentStatement.carryOutMinor > 0
        ? currentStatement.period.dueDate
        : (openPeriod?.period.dueDate ?? null),
  };
}

function emptyLedger(card: Card): CardLedger {
  return {
    cardId: card.id,
    periods: [],
    currentStatement: null,
    openPeriod: null,
    currentDueMinor: 0,
    openPeriodSpendMinor: 0,
    remainingInstallmentsMinor: 0,
    totalDebtMinor: 0,
    availableLimitMinor: card.creditLimitMinor,
    utilizationRatio: 0,
    nextDueDate: null,
  };
}

function maxMonth(a: string, b: string): string {
  return a > b ? a : b;
}

/**
 * Sanal kartlar ana kartın limitini paylaşır — limit doluluğu ana kart
 * üzerinden tek seferde hesaplanmalı, aksi halde limit iki kez sayılır.
 */
export function effectiveLimitMinor(card: Card, allCards: Card[]): number {
  if (card.parentCardId && card.sharesParentLimit) {
    const parent = allCards.find((c) => c.id === card.parentCardId);
    return parent?.creditLimitMinor ?? card.creditLimitMinor;
  }
  return card.creditLimitMinor;
}

/** Bir kartın kendisi ve ona bağlı, limitini paylaşan sanal kartları. */
export function cardFamily(card: Card, allCards: Card[]): Card[] {
  return [
    card,
    ...allCards.filter((c) => c.parentCardId === card.id && c.sharesParentLimit),
  ];
}
