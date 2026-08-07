import type { Installment } from "@/db/schema";
import { type ISODate, monthKey, today } from "./dates";
import { buildPeriod, type CardCycle } from "./statements";

/**
 * Taksitin yaşam döngüsü tamamen tarihlerden türetilir.
 *
 * Kullanıcı taksitleri tek tek "ödendi" diye işaretlemez — çünkü gerçekte
 * taksit ödenmez, EKSTRE ödenir. Bir taksit hangi ekstreye düştüyse o
 * ekstrenin durumunu paylaşır.
 */

export type InstallmentState =
  | "gecmis" // sisteme girmeden önce kapanıp ödenmiş
  | "odendi" // ekstresi kesildi ve kapandı
  | "bekliyor" // ekstresi kesildi, henüz ödenmedi
  | "bu_donemde" // henüz kesilmemiş, biriken ekstrede
  | "gelecek"; // ileri dönemler

export const STATE_LABEL: Record<InstallmentState, string> = {
  gecmis: "Sisteme girmeden önce ödenmiş",
  odendi: "Ödendi",
  bekliyor: "Ekstrede, ödenmedi",
  bu_donemde: "Bu dönemin ekstresinde",
  gelecek: "Gelecek dönem",
};

export const STATE_SHORT: Record<InstallmentState, string> = {
  gecmis: "geçmiş",
  odendi: "ödendi",
  bekliyor: "ödenmedi",
  bu_donemde: "bu ekstrede",
  gelecek: "gelecek",
};

export interface InstallmentSchedule {
  id: number;
  seq: number;
  amountMinor: number;
  /** Bu taksitin düştüğü ekstrenin kesim tarihi. */
  statementDate: ISODate;
  /** O ekstrenin son ödeme tarihi — taksitin gerçekte ödendiği gün. */
  dueDate: ISODate;
  state: InstallmentState;
  /** Borç hesabına dahil mi? Geçmiş taksitler dahil değildir. */
  countsAsDebt: boolean;
}

export interface ScheduleContext {
  cycle: CardCycle;
  /** Planın sisteme girildiği gün. Bu tarihten önce vadesi dolan ekstre geçmiştir. */
  planEntryDate: ISODate;
  /** Ledger'a göre kapanmış ve ödenmiş dönemlerin ay anahtarları. */
  settledMonths?: Set<string>;
  ref?: ISODate;
}

/**
 * Bir taksitin ait olduğu ekstre dönemini bulur.
 * Taksitin `dueDate` alanı zaten o dönemin kesim tarihidir.
 */
export function periodOfInstallment(dueDate: ISODate, cycle: CardCycle) {
  return buildPeriod(monthKey(dueDate), cycle);
}

/**
 * Bir taksitin sisteme girmeden önce kapanmış bir ekstreye ait olup
 * olmadığı: ekstrenin SON ÖDEME tarihi giriş gününden önceyse o para çoktan
 * ödenmiştir ve bugünkü borcun parçası değildir.
 *
 * Kesim tarihi yerine son ödeme tarihine bakılır: 22'sinde kesilip 3'ünde
 * ödenen bir ekstre, ayın 25'inde sisteme girildiğinde henüz ödenmemiştir.
 */
export function isSettledBeforeTracking(
  dueDate: ISODate,
  cycle: CardCycle,
  planEntryDate: ISODate,
): boolean {
  return periodOfInstallment(dueDate, cycle).dueDate < planEntryDate;
}

export function describeInstallment(
  installment: Pick<Installment, "id" | "seq" | "amountMinor" | "dueDate">,
  ctx: ScheduleContext,
): InstallmentSchedule {
  const ref = ctx.ref ?? today();
  const period = periodOfInstallment(installment.dueDate, ctx.cycle);

  let state: InstallmentState;
  if (period.dueDate < ctx.planEntryDate) {
    state = "gecmis";
  } else if (period.statementDate >= ref) {
    // Henüz kesilmemiş: içinde bulunulan dönem mi, ileri bir dönem mi?
    state = period.periodStart <= ref ? "bu_donemde" : "gelecek";
  } else if (ctx.settledMonths?.has(period.monthKey)) {
    state = "odendi";
  } else {
    state = "bekliyor";
  }

  return {
    id: installment.id,
    seq: installment.seq,
    amountMinor: installment.amountMinor,
    statementDate: period.statementDate,
    dueDate: period.dueDate,
    state,
    countsAsDebt: state !== "gecmis" && state !== "odendi",
  };
}

/**
 * Bir taksit planının takvimini önizler — henüz kaydedilmeden.
 * Giriş ekranında "1. taksit hangi ekstreye düşer" sorusunu cevaplar.
 */
export function previewSchedule(args: {
  totalAmountMinor: number;
  installmentCount: number;
  purchaseDate: ISODate;
  cycle: CardCycle;
}): Array<{ seq: number; amountMinor: number; statementDate: ISODate; dueDate: ISODate }> {
  const { totalAmountMinor, installmentCount, purchaseDate, cycle } = args;
  if (installmentCount < 1 || totalAmountMinor <= 0) return [];

  const base = Math.floor(totalAmountMinor / installmentCount);
  const remainder = totalAmountMinor - base * installmentCount;

  // Alışveriş kesim gününden sonraysa ilk taksit bir sonraki ekstreye düşer.
  const m = monthKey(purchaseDate);
  const thisMonth = buildPeriod(m, cycle);
  const startMonth =
    purchaseDate <= thisMonth.statementDate ? m : shiftMonth(m, 1);

  return Array.from({ length: installmentCount }, (_, i) => {
    const period = buildPeriod(shiftMonth(startMonth, i), cycle);
    return {
      seq: i + 1,
      amountMinor: base + (i < remainder ? 1 : 0),
      statementDate: period.statementDate,
      dueDate: period.dueDate,
    };
  });
}

function shiftMonth(key: string, months: number): string {
  const [y, m] = key.split("-").map(Number);
  const total = y * 12 + (m - 1) + months;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}
