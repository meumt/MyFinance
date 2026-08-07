import {
  addDays,
  addMonths,
  differenceInCalendarDays,
  differenceInCalendarMonths,
  format,
  getDaysInMonth,
  parseISO,
} from "date-fns";
import { tr } from "date-fns/locale";

export const TIMEZONE = "Europe/Istanbul";

/** Takvim tarihi: 'YYYY-MM-DD'. Saat/zaman dilimi taşımaz. */
export type ISODate = string;

export function today(): ISODate {
  return formatInTimeZone(new Date());
}

function formatInTimeZone(d: Date): ISODate {
  // tr-TR yerine 'en-CA' kullanılıyor çünkü çıktısı doğrudan YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

export function nowMs(): number {
  return Date.now();
}

/** 'YYYY-MM-DD' → Date (yerel saat 00:00, karşılaştırma için güvenli). */
export function toDate(iso: ISODate): Date {
  return parseISO(`${iso}T00:00:00`);
}

export function toISO(d: Date): ISODate {
  return format(d, "yyyy-MM-dd");
}

export function addDaysISO(iso: ISODate, days: number): ISODate {
  return toISO(addDays(toDate(iso), days));
}

export function addMonthsISO(iso: ISODate, months: number): ISODate {
  return toISO(addMonths(toDate(iso), months));
}

export function daysBetween(from: ISODate, to: ISODate): number {
  return differenceInCalendarDays(toDate(to), toDate(from));
}

export function monthsBetween(from: ISODate, to: ISODate): number {
  return differenceInCalendarMonths(toDate(to), toDate(from));
}

/** 'YYYY-MM' ay anahtarı — raporlama gruplamalarında kullanılır. */
export function monthKey(iso: ISODate): string {
  return iso.slice(0, 7);
}

export function monthStart(monthOrDate: string): ISODate {
  return `${monthOrDate.slice(0, 7)}-01`;
}

export function monthEnd(monthOrDate: string): ISODate {
  const start = toDate(monthStart(monthOrDate));
  return toISO(addDays(addMonths(start, 1), -1));
}

export function addMonthsToKey(monthKeyStr: string, months: number): string {
  return monthKey(addMonthsISO(monthStart(monthKeyStr), months));
}

/**
 * Ay uzunluğunu aşan gün numaralarını sona sabitler.
 * Kesim günü 31 olan bir kart şubatta 28'inde kesilir.
 */
export function clampDayToMonth(year: number, month1to12: number, day: number): number {
  const dim = getDaysInMonth(new Date(year, month1to12 - 1, 1));
  return Math.min(Math.max(day, 1), dim);
}

/**
 * Ayın gününü koruyarak ay ekler; kısa aylarda ay sonuna sabitler.
 * 31 Ocak + 1 ay = 28 Şubat (31 Mart değil) — taksit tarihleri kaymasın diye.
 */
export function addMonthsKeepingDay(iso: ISODate, months: number): ISODate {
  const [y, m, d] = iso.split("-").map(Number);
  const total = y * 12 + (m - 1) + months;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  const day = clampDayToMonth(year, month, d);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Belirli bir ay içinde, ayın gününü sabitleyerek tarih üretir. */
export function dateInMonth(monthKeyStr: string, day: number): ISODate {
  const [y, m] = monthKeyStr.split("-").map(Number);
  const d = clampDayToMonth(y, m, day);
  return `${monthKeyStr}-${String(d).padStart(2, "0")}`;
}

/* ────────────────────────────── Görsel biçimler ───────────────────────────── */

export function formatDateTR(iso: ISODate | null | undefined): string {
  if (!iso) return "—";
  return format(toDate(iso), "d MMM yyyy", { locale: tr });
}

export function formatDateShortTR(iso: ISODate | null | undefined): string {
  if (!iso) return "—";
  return format(toDate(iso), "d MMM", { locale: tr });
}

export function formatMonthTR(monthKeyStr: string): string {
  return format(toDate(monthStart(monthKeyStr)), "LLLL yyyy", { locale: tr });
}

export function formatMonthShortTR(monthKeyStr: string): string {
  return format(toDate(monthStart(monthKeyStr)), "LLL yy", { locale: tr });
}

export function formatTimestampTR(ms: number): string {
  return new Intl.DateTimeFormat("tr-TR", {
    timeZone: TIMEZONE,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(ms));
}

/** "3 gün sonra", "bugün", "2 gün gecikmiş" gibi insani ifade. */
export function relativeDayTR(target: ISODate, from: ISODate = today()): string {
  const diff = daysBetween(from, target);
  if (diff === 0) return "bugün";
  if (diff === 1) return "yarın";
  if (diff === -1) return "dün";
  if (diff > 0) return `${diff} gün sonra`;
  return `${Math.abs(diff)} gün gecikmiş`;
}

/** İki tarih arasındaki her ayın anahtarını sırayla döner. */
export function monthRange(fromMonth: string, toMonth: string): string[] {
  const out: string[] = [];
  let cursor = fromMonth.slice(0, 7);
  let guard = 0;
  while (cursor <= toMonth.slice(0, 7) && guard++ < 600) {
    out.push(cursor);
    cursor = addMonthsToKey(cursor, 1);
  }
  return out;
}
