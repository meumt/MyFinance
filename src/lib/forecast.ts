import type { FinancialSnapshot } from "./data";
import { monthlyEquivalent, monthlyTotals } from "./analytics";
import {
  addDaysISO,
  addMonthsISO,
  addMonthsToKey,
  dateInMonth,
  daysBetween,
  type ISODate,
  monthKey,
} from "./dates";
import { toTRYOrZero } from "./fx";

/**
 * İleriye dönük projeksiyonlar: yaklaşan ödemeler, nakit akışı takvimi
 * ve borçtan çıkış simülasyonu.
 */

/* ────────────────────────────── Yaklaşan ödemeler ────────────────────────── */

export type ObligationType =
  | "kart_ekstre"
  | "kredi_taksit"
  | "abonelik"
  | "duzenli_gider"
  | "duzenli_gelir";

export type Severity = "bilgi" | "uyari" | "kritik";

export interface Obligation {
  date: ISODate;
  type: ObligationType;
  label: string;
  detail: string;
  /** TL karşılığı — sıralama ve toplama bu tutar üzerinden yapılır. */
  amountMinor: number;
  originalAmountMinor: number;
  currency: string;
  entityId: number;
  cardId: number | null;
  accountId: number | null;
  /** Kart ekstresi için asgari ödeme tutarı. */
  minimumMinor: number | null;
  isIncome: boolean;
  /** Banka hesabından doğrudan çıkacak mı? Kartla ödenenler ekstreye yansır. */
  affectsCash: boolean;
  severity: Severity;
  daysUntil: number;
}

export interface ObligationOptions {
  days?: number;
  /** Gecikmiş ödemeler de listelensin mi? */
  includeOverdue?: boolean;
}

export function upcomingObligations(
  snap: FinancialSnapshot,
  options: ObligationOptions = {},
): Obligation[] {
  const days = options.days ?? 90;
  const includeOverdue = options.includeOverdue ?? true;
  const horizon = addDaysISO(snap.ref, days);
  const floor = includeOverdue ? addDaysISO(snap.ref, -180) : snap.ref;

  const out: Obligation[] = [];

  /* 1) Kredi kartı ekstreleri */
  for (const card of snap.cards) {
    if (!card.isActive) continue;
    const ledger = snap.ledgers.get(card.id);
    if (!ledger || ledger.periods.length === 0) continue;

    let isFirstUpcoming = true;
    for (const p of ledger.periods) {
      if (p.period.dueDate < floor || p.period.dueDate > horizon) continue;

      /* İlk yaklaşan ödeme gerçek devreden borçtur. Sonraki dönemler için
         "her ay ekstre tamamen ödeniyor" varsayılır; aksi halde devreden
         tutar tekrar tekrar sayılır. */
      const ownAccrual =
        p.chargesMinor + p.installmentsMinor + p.feesMinor - p.refundsMinor;
      const amount = isFirstUpcoming
        ? Math.max(0, p.totalDueMinor - p.paymentsMinor)
        : Math.max(0, ownAccrual);

      if (amount <= 0) {
        if (p.period.dueDate >= snap.ref) isFirstUpcoming = false;
        continue;
      }

      const daysUntil = daysBetween(snap.ref, p.period.dueDate);
      out.push({
        date: p.period.dueDate,
        type: "kart_ekstre",
        label: card.name,
        detail: isFirstUpcoming
          ? `Dönem borcu · kesim ${p.period.statementDate.slice(8)}`
          : `Tahmini ekstre · ${p.installmentsMinor > 0 ? "taksit dahil" : "dönem harcaması"}`,
        amountMinor: toTRYOrZero(amount, card.currency, snap.rates),
        originalAmountMinor: amount,
        currency: card.currency,
        entityId: card.id,
        cardId: card.id,
        accountId: card.linkedAccountId,
        minimumMinor: isFirstUpcoming ? p.minimumDueMinor : null,
        isIncome: false,
        affectsCash: true,
        severity: severityFor(daysUntil),
        daysUntil,
      });

      isFirstUpcoming = false;
    }
  }

  /* 2) Kredi taksitleri */
  for (const payment of snap.loanPayments) {
    if (payment.isPaid) continue;
    if (payment.dueDate < floor || payment.dueDate > horizon) continue;

    const loan = snap.loans.find((l) => l.id === payment.loanId);
    if (!loan || loan.status !== "aktif") continue;

    const daysUntil = daysBetween(snap.ref, payment.dueDate);
    out.push({
      date: payment.dueDate,
      type: "kredi_taksit",
      label: loan.name,
      detail: `${payment.seq}. taksit / ${loan.installmentCount}`,
      amountMinor: toTRYOrZero(payment.amountMinor, loan.currency, snap.rates),
      originalAmountMinor: payment.amountMinor,
      currency: loan.currency,
      entityId: payment.id,
      cardId: null,
      accountId: loan.paymentAccountId,
      minimumMinor: null,
      isIncome: false,
      affectsCash: true,
      severity: severityFor(daysUntil),
      daysUntil,
    });
  }

  /* 3) Abonelik yenilemeleri — periyoda göre ufka kadar tekrarlanır */
  for (const sub of snap.subscriptions) {
    if (!sub.isActive) continue;

    for (const date of repeatDates(sub.nextRenewalDate, sub.cycle, sub.cycleDays, horizon)) {
      if (date < floor) continue;
      if (sub.endDate && date > sub.endDate) break;

      const daysUntil = daysBetween(snap.ref, date);
      out.push({
        date,
        type: "abonelik",
        label: sub.name,
        detail: sub.paymentCardId
          ? `${snap.cardById.get(sub.paymentCardId)?.name ?? "kart"} ile yenilenir`
          : "hesaptan çekilir",
        amountMinor: toTRYOrZero(sub.amountMinor, sub.currency, snap.rates),
        originalAmountMinor: sub.amountMinor,
        currency: sub.currency,
        entityId: sub.id,
        cardId: sub.paymentCardId,
        accountId: sub.paymentAccountId,
        minimumMinor: null,
        isIncome: false,
        // Kartla ödenen abonelik nakit akışını doğrudan etkilemez; ekstreye girer.
        affectsCash: sub.paymentCardId == null,
        severity: severityFor(daysUntil),
        daysUntil,
      });
    }
  }

  /* 4) Düzenli gelir ve giderler */
  for (const item of snap.recurring) {
    if (!item.isActive) continue;

    for (const date of repeatDates(item.nextDate, item.cycle, null, horizon)) {
      if (date < floor) continue;
      if (item.endDate && date > item.endDate) break;

      const daysUntil = daysBetween(snap.ref, date);
      const isIncome = item.kind === "gelir";
      out.push({
        date,
        type: isIncome ? "duzenli_gelir" : "duzenli_gider",
        label: item.name,
        detail: isIncome ? "düzenli gelir" : "düzenli gider",
        amountMinor: toTRYOrZero(item.amountMinor, item.currency, snap.rates),
        originalAmountMinor: item.amountMinor,
        currency: item.currency,
        entityId: item.id,
        cardId: item.cardId,
        accountId: item.accountId,
        minimumMinor: null,
        isIncome,
        affectsCash: item.cardId == null,
        severity: isIncome ? "bilgi" : severityFor(daysUntil),
        daysUntil,
      });
    }
  }

  return out.sort((a, b) => a.date.localeCompare(b.date) || b.amountMinor - a.amountMinor);
}

function severityFor(daysUntil: number): Severity {
  if (daysUntil < 0) return "kritik";
  if (daysUntil <= 3) return "uyari";
  return "bilgi";
}

/** Bir başlangıç tarihinden itibaren periyodik tarihleri ufka kadar üretir. */
function repeatDates(
  start: ISODate,
  cycle: string,
  cycleDays: number | null | undefined,
  horizon: ISODate,
): ISODate[] {
  const out: ISODate[] = [];
  let cursor = start;
  let guard = 0;

  while (cursor <= horizon && guard++ < 200) {
    out.push(cursor);
    switch (cycle) {
      case "haftalik":
        cursor = addDaysISO(cursor, 7);
        break;
      case "aylik":
        cursor = addMonthsISO(cursor, 1);
        break;
      case "uc_aylik":
        cursor = addMonthsISO(cursor, 3);
        break;
      case "alti_aylik":
        cursor = addMonthsISO(cursor, 6);
        break;
      case "yillik":
        cursor = addMonthsISO(cursor, 12);
        break;
      case "ozel":
        cursor = addDaysISO(cursor, cycleDays && cycleDays > 0 ? cycleDays : 30);
        break;
      default:
        cursor = addMonthsISO(cursor, 1);
    }
  }
  return out;
}

/* ────────────────────────────── Nakit akışı takvimi ──────────────────────── */

export interface CashflowDay {
  date: ISODate;
  /** Gün sonunda beklenen toplam likit bakiye (TL). */
  balanceMinor: number;
  inflowMinor: number;
  outflowMinor: number;
  obligations: Obligation[];
  /** Bakiye eksiye düşüyor mu? */
  isNegative: boolean;
  /** Ek hesap limiti de tükeniyor mu? */
  exceedsOverdraft: boolean;
}

export interface CashflowProjection {
  days: CashflowDay[];
  startBalanceMinor: number;
  overdraftHeadroomMinor: number;
  /** Bakiyenin ilk kez eksiye düştüğü gün. */
  firstNegativeDate: ISODate | null;
  /** Ufuk boyunca görülen en düşük bakiye. */
  minBalanceMinor: number;
  minBalanceDate: ISODate | null;
  totalInflowMinor: number;
  totalOutflowMinor: number;
}

export function cashflowProjection(
  snap: FinancialSnapshot,
  days = 90,
): CashflowProjection {
  let startBalance = 0;
  let overdraftHeadroom = 0;

  for (const account of snap.accounts) {
    if (!account.isActive || account.type === "vadeli") continue;
    const bal = snap.balances.get(account.id);
    if (!bal) continue;
    startBalance += toTRYOrZero(bal.balanceMinor, account.currency, snap.rates);
    overdraftHeadroom += toTRYOrZero(
      bal.overdraftAvailableMinor,
      account.currency,
      snap.rates,
    );
  }

  const obligations = upcomingObligations(snap, { days, includeOverdue: false });
  const byDate = new Map<ISODate, Obligation[]>();
  for (const o of obligations) {
    if (!o.affectsCash) continue;
    if (!byDate.has(o.date)) byDate.set(o.date, []);
    byDate.get(o.date)!.push(o);
  }

  const out: CashflowDay[] = [];
  let running = startBalance;
  let minBalance = startBalance;
  let minDate: ISODate | null = snap.ref;
  let firstNegative: ISODate | null = null;
  let totalIn = 0;
  let totalOut = 0;

  for (let i = 0; i <= days; i++) {
    const date = addDaysISO(snap.ref, i);
    const dayObligations = byDate.get(date) ?? [];

    let inflow = 0;
    let outflow = 0;
    for (const o of dayObligations) {
      if (o.isIncome) inflow += o.amountMinor;
      else outflow += o.amountMinor;
    }

    running += inflow - outflow;
    totalIn += inflow;
    totalOut += outflow;

    if (running < minBalance) {
      minBalance = running;
      minDate = date;
    }
    if (running < 0 && firstNegative === null) firstNegative = date;

    out.push({
      date,
      balanceMinor: running,
      inflowMinor: inflow,
      outflowMinor: outflow,
      obligations: dayObligations,
      isNegative: running < 0,
      exceedsOverdraft: running + overdraftHeadroom < 0,
    });
  }

  return {
    days: out,
    startBalanceMinor: startBalance,
    overdraftHeadroomMinor: overdraftHeadroom,
    firstNegativeDate: firstNegative,
    minBalanceMinor: minBalance,
    minBalanceDate: minDate,
    totalInflowMinor: totalIn,
    totalOutflowMinor: totalOut,
  };
}

/* ───────────────────────── Borçtan çıkış projeksiyonu ────────────────────── */

export interface PayoffAssumptions {
  /** Aylık ortalama net gelir (TL kuruş). */
  monthlyIncomeMinor: number;
  /** Borç ödemeleri hariç aylık ortalama gider. */
  monthlyExpenseMinor: number;
  /** Her ay borca ayrılabilecek ek tutar. */
  extraPaymentMinor: number;
  /** cig = en yüksek faizli önce, kartopu = en küçük bakiye önce */
  strategy: "cig" | "kartopu";
  maxMonths: number;
}

export interface PayoffMonth {
  month: string;
  /** Ay başındaki toplam borç. */
  openingDebtMinor: number;
  installmentsMinor: number;
  loanPaymentsMinor: number;
  revolvingPaymentMinor: number;
  interestMinor: number;
  totalPaidMinor: number;
  closingDebtMinor: number;
  /** Bu ay borca ayrılabilen tutar yetersiz kaldıysa true. */
  shortfall: boolean;
}

export interface PayoffProjection {
  assumptions: PayoffAssumptions;
  months: PayoffMonth[];
  /** Tüm borcun bittiği ay; ufukta bitmiyorsa null. */
  debtFreeMonth: string | null;
  monthsToDebtFree: number | null;
  totalInterestMinor: number;
  startingDebtMinor: number;
  /** Aylık borca ayrılabilen tutar (gelir − gider). */
  monthlyCapacityMinor: number;
  /** Kapasite negatifse borç kapanmaz — kullanıcıya net uyarı için. */
  isSustainable: boolean;
  /** Sadece mevcut taksitler bitene kadar geçecek süre. */
  installmentFreeMonth: string | null;
}

/**
 * "Kaç ayda toparlarım" simülasyonu.
 *
 * Her ay sırasıyla: taksitler ve kredi taksitleri ödenir (bunlar zorunludur),
 * kalan kapasite dönen kart borcuna ve ek hesaba yatırılır. Ödenemeyen dönen
 * borca aylık akdi faiz işler.
 */
export function payoffProjection(
  snap: FinancialSnapshot,
  overrides: Partial<PayoffAssumptions> = {},
): PayoffProjection {
  const history = monthlyTotals(snap, 4).slice(0, -1); // içinde bulunulan ay hariç
  const completed = history.filter((m) => m.incomeMinor > 0 || m.expenseMinor > 0);

  const avgIncome =
    completed.length > 0
      ? Math.round(completed.reduce((s, m) => s + m.incomeMinor, 0) / completed.length)
      : 0;
  const avgExpense =
    completed.length > 0
      ? Math.round(completed.reduce((s, m) => s + m.expenseMinor, 0) / completed.length)
      : 0;

  const assumptions: PayoffAssumptions = {
    monthlyIncomeMinor: overrides.monthlyIncomeMinor ?? avgIncome,
    monthlyExpenseMinor: overrides.monthlyExpenseMinor ?? avgExpense,
    extraPaymentMinor: overrides.extraPaymentMinor ?? 0,
    strategy: overrides.strategy ?? "cig",
    maxMonths: overrides.maxMonths ?? 120,
  };

  const capacity =
    assumptions.monthlyIncomeMinor -
    assumptions.monthlyExpenseMinor +
    assumptions.extraPaymentMinor;

  /* Dönen (faiz işleyen) borçlar: kart devreden borcu + ek hesap kullanımı */
  interface RevolvingDebt {
    id: string;
    label: string;
    balanceMinor: number;
    monthlyRateBps: number;
  }

  const revolving: RevolvingDebt[] = [];

  for (const card of snap.cards) {
    if (!card.isActive) continue;
    const ledger = snap.ledgers.get(card.id);
    if (!ledger) continue;
    const carry = ledger.currentDueMinor;
    if (carry <= 0) continue;
    revolving.push({
      id: `kart-${card.id}`,
      label: card.name,
      balanceMinor: toTRYOrZero(carry, card.currency, snap.rates),
      monthlyRateBps: snap.settings.cardMonthlyRateBps,
    });
  }

  for (const account of snap.accounts) {
    if (!account.isActive) continue;
    const bal = snap.balances.get(account.id);
    if (!bal || bal.overdraftUsedMinor <= 0) continue;
    const annual =
      account.overdraftRateBps || snap.settings.overdraftDefaultAnnualRateBps;
    revolving.push({
      id: `kmh-${account.id}`,
      label: `${account.name} (ek hesap)`,
      balanceMinor: toTRYOrZero(
        bal.overdraftUsedMinor,
        account.currency,
        snap.rates,
      ),
      monthlyRateBps: Math.round(annual / 12),
    });
  }

  /* Sabit takvimli borçlar: taksitler ve kredi ödemeleri */
  const installmentsByMonth = new Map<string, number>();
  for (const inst of snap.installments) {
    if (inst.isPaid || inst.dueDate < snap.ref) continue;
    const plan = snap.planById.get(inst.planId);
    if (!plan) continue;
    const m = monthKey(inst.dueDate);
    installmentsByMonth.set(
      m,
      (installmentsByMonth.get(m) ?? 0) +
        toTRYOrZero(inst.amountMinor, plan.currency, snap.rates),
    );
  }

  const loansByMonth = new Map<string, number>();
  for (const payment of snap.loanPayments) {
    if (payment.isPaid || payment.dueDate < snap.ref) continue;
    const loan = snap.loans.find((l) => l.id === payment.loanId);
    if (!loan || loan.status !== "aktif") continue;
    const m = monthKey(payment.dueDate);
    loansByMonth.set(
      m,
      (loansByMonth.get(m) ?? 0) +
        toTRYOrZero(payment.amountMinor, loan.currency, snap.rates),
    );
  }

  const scheduledTotal =
    sumValues(installmentsByMonth) + sumValues(loansByMonth);
  const revolvingTotal = revolving.reduce((s, d) => s + d.balanceMinor, 0);
  const startingDebt = scheduledTotal + revolvingTotal;

  const lastInstallmentMonth = maxKey(installmentsByMonth);

  /* Simülasyon */
  const months: PayoffMonth[] = [];
  let debtFreeMonth: string | null = null;
  let totalInterest = 0;
  let cursor = monthKey(snap.ref);

  const remainingScheduled = new Map(
    [...installmentsByMonth.entries()].map(([m, v]) => [
      m,
      v + (loansByMonth.get(m) ?? 0),
    ]),
  );
  for (const [m, v] of loansByMonth) {
    if (!remainingScheduled.has(m)) remainingScheduled.set(m, v);
  }

  for (let i = 0; i < assumptions.maxMonths; i++) {
    const scheduledThisMonth = remainingScheduled.get(cursor) ?? 0;
    const revolvingBefore = revolving.reduce((s, d) => s + d.balanceMinor, 0);
    const scheduledRemaining = sumFrom(remainingScheduled, cursor);
    const openingDebt = revolvingBefore + scheduledRemaining;

    if (openingDebt <= 0) {
      debtFreeMonth = debtFreeMonth ?? cursor;
      break;
    }

    /* Faiz tahakkuku */
    let interest = 0;
    for (const debt of revolving) {
      if (debt.balanceMinor <= 0) continue;
      const accrued = Math.round((debt.balanceMinor * debt.monthlyRateBps) / 10000);
      debt.balanceMinor += accrued;
      interest += accrued;
    }
    totalInterest += interest;

    /* Zorunlu ödemeler önce */
    let budget = capacity;
    const scheduledPaid = Math.min(scheduledThisMonth, Math.max(0, budget));
    budget -= scheduledPaid;
    const shortfall = scheduledPaid < scheduledThisMonth;

    /* Kalan kapasite dönen borca — seçilen stratejiye göre sıralanır */
    const ordered = [...revolving]
      .filter((d) => d.balanceMinor > 0)
      .sort((a, b) =>
        assumptions.strategy === "cig"
          ? b.monthlyRateBps - a.monthlyRateBps
          : a.balanceMinor - b.balanceMinor,
      );

    let revolvingPaid = 0;
    for (const debt of ordered) {
      if (budget <= 0) break;
      const pay = Math.min(debt.balanceMinor, budget);
      debt.balanceMinor -= pay;
      budget -= pay;
      revolvingPaid += pay;
    }

    remainingScheduled.set(cursor, scheduledThisMonth - scheduledPaid);

    const closingDebt =
      revolving.reduce((s, d) => s + d.balanceMinor, 0) +
      sumFrom(remainingScheduled, addMonthsToKey(cursor, 1)) +
      Math.max(0, scheduledThisMonth - scheduledPaid);

    months.push({
      month: cursor,
      openingDebtMinor: openingDebt,
      installmentsMinor: installmentsByMonth.get(cursor) ?? 0,
      loanPaymentsMinor: loansByMonth.get(cursor) ?? 0,
      revolvingPaymentMinor: revolvingPaid,
      interestMinor: interest,
      totalPaidMinor: scheduledPaid + revolvingPaid,
      closingDebtMinor: closingDebt,
      shortfall,
    });

    if (closingDebt <= 0) {
      debtFreeMonth = cursor;
      break;
    }

    cursor = addMonthsToKey(cursor, 1);
  }

  return {
    assumptions,
    months,
    debtFreeMonth,
    monthsToDebtFree: debtFreeMonth
      ? months.findIndex((m) => m.month === debtFreeMonth) + 1
      : null,
    totalInterestMinor: totalInterest,
    startingDebtMinor: startingDebt,
    monthlyCapacityMinor: capacity,
    isSustainable: capacity > 0,
    installmentFreeMonth: lastInstallmentMonth,
  };
}

function sumValues(map: Map<string, number>): number {
  let total = 0;
  for (const v of map.values()) total += v;
  return total;
}

function sumFrom(map: Map<string, number>, fromMonth: string): number {
  let total = 0;
  for (const [m, v] of map) {
    if (m >= fromMonth) total += v;
  }
  return total;
}

function maxKey(map: Map<string, number>): string | null {
  let max: string | null = null;
  for (const [m, v] of map) {
    if (v > 0 && (max === null || m > max)) max = m;
  }
  return max;
}

/* ───────────────────────── Acil durum fonu dayanma süresi ────────────────── */

export interface RunwayInfo {
  /** Likit varlıkla kaç ay zorunlu gider karşılanabilir. */
  months: number;
  liquidMinor: number;
  monthlyEssentialMinor: number;
}

export function emergencyRunway(snap: FinancialSnapshot): RunwayInfo {
  const history = monthlyTotals(snap, 4).slice(0, -1);
  const withData = history.filter((m) => m.expenseMinor > 0);
  const monthlyEssential =
    withData.length > 0
      ? Math.round(
          withData.reduce((s, m) => s + Math.max(m.essentialMinor, 0), 0) /
            withData.length,
        )
      : 0;

  let liquid = 0;
  for (const account of snap.accounts) {
    if (!account.isActive || account.excludeFromNetWorth) continue;
    const bal = snap.balances.get(account.id);
    if (!bal || bal.balanceMinor <= 0) continue;
    liquid += toTRYOrZero(bal.balanceMinor, account.currency, snap.rates);
  }

  return {
    months: monthlyEssential > 0 ? liquid / monthlyEssential : 0,
    liquidMinor: liquid,
    monthlyEssentialMinor: monthlyEssential,
  };
}

/* ─────────────────── Abonelik yenileme tarihini ilerlet ──────────────────── */

/** Bir abonelik yenilendiğinde bir sonraki tarihi hesaplar. */
export function nextRenewal(
  current: ISODate,
  cycle: string,
  cycleDays?: number | null,
): ISODate {
  switch (cycle) {
    case "haftalik":
      return addDaysISO(current, 7);
    case "uc_aylik":
      return addMonthsISO(current, 3);
    case "alti_aylik":
      return addMonthsISO(current, 6);
    case "yillik":
      return addMonthsISO(current, 12);
    case "ozel":
      return addDaysISO(current, cycleDays && cycleDays > 0 ? cycleDays : 30);
    case "aylik":
    default:
      return addMonthsISO(current, 1);
  }
}

/** Düzenli kalem için bir sonraki tarih; ayın gününü korur. */
export function nextRecurring(
  current: ISODate,
  cycle: string,
  dayOfMonth: number,
): ISODate {
  if (cycle === "haftalik") return addDaysISO(current, 7);
  if (cycle === "yillik") return addMonthsISO(current, 12);
  return dateInMonth(addMonthsToKey(monthKey(current), 1), dayOfMonth);
}

export { monthlyEquivalent };
