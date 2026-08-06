/**
 * Tüm parasal değerler kuruş (minor unit) cinsinden tam sayıdır.
 * Bu dosyanın dışında hiçbir yerde para için float kullanılmamalıdır.
 */

export type CurrencyCode = "TRY" | "USD" | "EUR" | "GBP" | "XAU" | "XAG";

export interface CurrencyMeta {
  code: CurrencyCode;
  symbol: string;
  label: string;
  /** Küsurat basamağı — tümü 2, altın/gümüş gram cinsinden 2 hane. */
  decimals: number;
  /** Gram altın gibi "emtia" birimleri arayüzde farklı gösterilir. */
  isCommodity?: boolean;
}

export const CURRENCIES: Record<CurrencyCode, CurrencyMeta> = {
  TRY: { code: "TRY", symbol: "₺", label: "Türk Lirası", decimals: 2 },
  USD: { code: "USD", symbol: "$", label: "ABD Doları", decimals: 2 },
  EUR: { code: "EUR", symbol: "€", label: "Euro", decimals: 2 },
  GBP: { code: "GBP", symbol: "£", label: "İngiliz Sterlini", decimals: 2 },
  XAU: {
    code: "XAU",
    symbol: "gr",
    label: "Gram Altın",
    decimals: 2,
    isCommodity: true,
  },
  XAG: {
    code: "XAG",
    symbol: "gr",
    label: "Gram Gümüş",
    decimals: 2,
    isCommodity: true,
  },
};

export const CURRENCY_CODES = Object.keys(CURRENCIES) as CurrencyCode[];
export const BASE_CURRENCY: CurrencyCode = "TRY";

export function isCurrencyCode(value: string): value is CurrencyCode {
  return value in CURRENCIES;
}

/**
 * Tek bir ayraç varken binlik mi ondalık mı olduğuna karar verir.
 * Türkiye'de "2.500" = iki bin beş yüz, "2,50" = iki lira elli kuruş.
 * Ayraçtan sonra tam üç hane varsa ve tam kısım binlik grup olabilecek
 * biçimdeyse (başında 0 yok, en fazla 3 hane) binlik ayraç kabul edilir.
 */
function isThousandsSeparator(s: string, sep: string): boolean {
  const parts = s.split(sep);
  if (parts.length > 2) return true; // "1.234.567" — tartışmasız binlik
  const [head, tail] = parts;
  if (tail?.length !== 3) return false;
  return head.length > 0 && head.length <= 3 && !head.startsWith("0");
}

/** "1.234,56" / "1234.56" / "1 234,56" gibi Türkçe girdileri kuruşa çevirir. */
export function parseMoneyToMinor(input: string | number): number | null {
  if (typeof input === "number") {
    if (!Number.isFinite(input)) return null;
    return Math.round(input * 100);
  }

  let s = input.trim().replace(/[₺$€£]/g, "").replace(/\s| /g, "");
  if (!s) return null;

  const negative = /^-/.test(s) || /^\(.*\)$/.test(s);
  s = s.replace(/^-/, "").replace(/^\((.*)\)$/, "$1");

  const hasComma = s.includes(",");
  const hasDot = s.includes(".");

  if (hasComma && hasDot) {
    // İki ayraç birlikteyse sonda gelen ondalıktır: "1.234,56" veya "1,234.56"
    s =
      s.lastIndexOf(",") > s.lastIndexOf(".")
        ? s.replace(/\./g, "").replace(",", ".")
        : s.replace(/,/g, "");
  } else if (hasComma || hasDot) {
    const sep = hasComma ? "," : ".";
    s = isThousandsSeparator(s, sep)
      ? s.split(sep).join("")
      : s.replace(sep, ".");
  }

  if (!/^\d*\.?\d*$/.test(s) || s === "" || s === ".") return null;

  const value = Number(s);
  if (!Number.isFinite(value)) return null;

  const minor = Math.round(value * 100);
  return negative ? -minor : minor;
}

/** Kuruşu ekranda gösterilecek biçime çevirir: 123456 → "1.234,56 ₺" */
export function formatMoney(
  minor: number,
  currency: CurrencyCode | string = "TRY",
  options: { showSymbol?: boolean; signed?: boolean; compact?: boolean } = {},
): string {
  const { showSymbol = true, signed = false, compact = false } = options;
  const meta = CURRENCIES[currency as CurrencyCode] ?? CURRENCIES.TRY;
  const value = minor / 100;

  let body: string;
  if (compact && Math.abs(value) >= 1000) {
    body = new Intl.NumberFormat("tr-TR", {
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(value);
  } else {
    body = new Intl.NumberFormat("tr-TR", {
      minimumFractionDigits: meta.decimals,
      maximumFractionDigits: meta.decimals,
    }).format(value);
  }

  const sign = signed && minor > 0 ? "+" : "";
  if (!showSymbol) return `${sign}${body}`;
  return meta.isCommodity
    ? `${sign}${body} ${meta.symbol}`
    : `${sign}${body} ${meta.symbol}`;
}

/** Kuruşu düzenleme alanına konacak ham biçime çevirir: 123456 → "1234,56" */
export function minorToInputString(minor: number): string {
  return (minor / 100).toFixed(2).replace(".", ",");
}

/**
 * Bir tutarı N parçaya böler; küsuratı kaybetmemek için artan kuruşları
 * ilk taksitlere dağıtır. Toplam her zaman girilen tutara eşittir.
 */
export function splitMinor(totalMinor: number, parts: number): number[] {
  if (parts <= 0) return [];
  const base = Math.floor(Math.abs(totalMinor) / parts);
  const remainder = Math.abs(totalMinor) - base * parts;
  const sign = totalMinor < 0 ? -1 : 1;
  return Array.from({ length: parts }, (_, i) =>
    sign * (base + (i < remainder ? 1 : 0)),
  );
}

/** Baz puanı yüzdeye çevirir: 4500 bps → "%45,00" */
export function formatBps(bps: number): string {
  return `%${(bps / 100).toLocaleString("tr-TR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatPercent(ratio: number, digits = 1): string {
  return `%${(ratio * 100).toLocaleString("tr-TR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}
