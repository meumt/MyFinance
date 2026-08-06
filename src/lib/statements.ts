import {
  addDaysISO,
  addMonthsToKey,
  daysBetween,
  dateInMonth,
  ISODate,
  monthKey,
  today,
} from "./dates";

/**
 * Türk kredi kartı dönem mantığı.
 *
 * Bir kartın iki günü vardır:
 *   - hesap kesim günü (statementDay): ekstrenin kapandığı gün
 *   - son ödeme günü (dueDay): ekstrenin ödenmesi gereken son gün
 *
 * Son ödeme günü kesim gününden BÜYÜKSE aynı ay içindedir (kesim 15 → ödeme 25).
 * KÜÇÜK veya EŞİTSE ertesi aya taşar (kesim 25 → ödeme 5).
 *
 * Bir harcamanın hangi ekstreye düştüğü: harcama tarihi <= kesim tarihi ise
 * o ayın ekstresine, sonra ise bir sonraki ekstreye yazılır.
 */

export interface CardCycle {
  statementDay: number;
  dueDay: number;
}

export interface StatementPeriod {
  /** Dönemin ilk günü (önceki kesimin ertesi günü). */
  periodStart: ISODate;
  /** Dönemin son günü = hesap kesim tarihi. */
  periodEnd: ISODate;
  statementDate: ISODate;
  dueDate: ISODate;
  /** Ekstrenin ait olduğu ay anahtarı ('YYYY-MM'), kesim tarihine göre. */
  monthKey: string;
}

/** Verilen ayın kesim tarihini döner (ay uzunluğuna sabitlenmiş). */
export function statementDateForMonth(
  monthKeyStr: string,
  cycle: CardCycle,
): ISODate {
  return dateInMonth(monthKeyStr, cycle.statementDay);
}

/** Bir kesim tarihine karşılık gelen son ödeme tarihini hesaplar. */
export function dueDateForStatement(
  statementDate: ISODate,
  cycle: CardCycle,
): ISODate {
  const stMonth = monthKey(statementDate);
  const sameMonth = cycle.dueDay > cycle.statementDay;
  const targetMonth = sameMonth ? stMonth : addMonthsToKey(stMonth, 1);
  return dateInMonth(targetMonth, cycle.dueDay);
}

/** Kesim tarihi belirtilen aya ait olan dönemin tamamını üretir. */
export function buildPeriod(
  monthKeyStr: string,
  cycle: CardCycle,
): StatementPeriod {
  const statementDate = statementDateForMonth(monthKeyStr, cycle);
  const prevStatement = statementDateForMonth(
    addMonthsToKey(monthKeyStr, -1),
    cycle,
  );
  return {
    periodStart: addDaysISO(prevStatement, 1),
    periodEnd: statementDate,
    statementDate,
    dueDate: dueDateForStatement(statementDate, cycle),
    monthKey: monthKeyStr,
  };
}

/**
 * Bir harcamanın düşeceği ekstre dönemini bulur.
 * Kesim gününde veya öncesinde yapılan harcama o ayın ekstresine girer.
 */
export function periodForTransaction(
  txDate: ISODate,
  cycle: CardCycle,
): StatementPeriod {
  const m = monthKey(txDate);
  const thisMonthStatement = statementDateForMonth(m, cycle);
  const targetMonth = txDate <= thisMonthStatement ? m : addMonthsToKey(m, 1);
  return buildPeriod(targetMonth, cycle);
}

/** Bugün itibarıyla henüz kesilmemiş (biriken) dönem. */
export function currentOpenPeriod(
  cycle: CardCycle,
  ref: ISODate = today(),
): StatementPeriod {
  return periodForTransaction(ref, cycle);
}

/**
 * Bugün itibarıyla en son kesilmiş ve ödenmesi beklenen dönem.
 * Açık dönemin bir öncesidir.
 */
export function lastClosedPeriod(
  cycle: CardCycle,
  ref: ISODate = today(),
): StatementPeriod {
  const open = currentOpenPeriod(cycle, ref);
  return buildPeriod(addMonthsToKey(open.monthKey, -1), cycle);
}

/** Gelecek N dönemi sırayla üretir (nakit akışı projeksiyonu için). */
export function upcomingPeriods(
  cycle: CardCycle,
  count: number,
  ref: ISODate = today(),
): StatementPeriod[] {
  const start = currentOpenPeriod(cycle, ref);
  return Array.from({ length: count }, (_, i) =>
    buildPeriod(addMonthsToKey(start.monthKey, i), cycle),
  );
}

/* ─────────────────────────────── Asgari ödeme ─────────────────────────────── */

/**
 * BDDK asgari ödeme oranları. Mevzuat değiştiğinde ayarlar ekranından
 * güncellenebilsin diye eşik ve oranlar parametrik tutuldu.
 */
export interface MinimumPaymentPolicy {
  /** Bu limitin (kuruş) altındaki kartlarda düşük oran uygulanır. */
  limitThresholdMinor: number;
  lowRateBps: number;
  highRateBps: number;
  /** Kartın ilk yılında uygulanan oran. */
  firstYearRateBps: number;
}

export const DEFAULT_MINIMUM_POLICY: MinimumPaymentPolicy = {
  limitThresholdMinor: 25_000_00,
  lowRateBps: 2000, // %20
  highRateBps: 4000, // %40
  firstYearRateBps: 4000, // %40
};

export function minimumPaymentMinor(
  totalDueMinor: number,
  creditLimitMinor: number,
  options: {
    policy?: MinimumPaymentPolicy;
    isFirstYear?: boolean;
  } = {},
): number {
  const policy = options.policy ?? DEFAULT_MINIMUM_POLICY;
  if (totalDueMinor <= 0) return 0;

  const rateBps = options.isFirstYear
    ? policy.firstYearRateBps
    : creditLimitMinor >= policy.limitThresholdMinor
      ? policy.highRateBps
      : policy.lowRateBps;

  return Math.min(totalDueMinor, Math.ceil((totalDueMinor * rateBps) / 10000));
}

/* ─────────────────────────── Durum yardımcıları ───────────────────────────── */

export type StatementStatus =
  | "acik"
  | "kapali"
  | "odendi"
  | "kismi"
  | "gecikmis";

export const STATEMENT_STATUS_LABEL: Record<StatementStatus, string> = {
  acik: "Açık dönem",
  kapali: "Kesildi, ödenmedi",
  odendi: "Ödendi",
  kismi: "Kısmi ödendi",
  gecikmis: "Gecikmiş",
};

export function deriveStatementStatus(args: {
  statementDate: ISODate;
  dueDate: ISODate;
  totalDueMinor: number;
  paidMinor: number;
  ref?: ISODate;
}): StatementStatus {
  const ref = args.ref ?? today();
  if (ref <= args.statementDate) return "acik";
  if (args.totalDueMinor <= 0) return "odendi";
  if (args.paidMinor >= args.totalDueMinor) return "odendi";
  if (ref > args.dueDate) return "gecikmis";
  return args.paidMinor > 0 ? "kismi" : "kapali";
}

/** Son ödeme tarihine kalan gün; negatifse gecikme. */
export function daysUntilDue(dueDate: ISODate, ref: ISODate = today()): number {
  return daysBetween(ref, dueDate);
}
