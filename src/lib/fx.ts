import "server-only";

import { and, desc, eq, lte } from "drizzle-orm";
import { db } from "@/db";
import { exchangeRates } from "@/db/schema";
import { type ISODate, today } from "./dates";
import { BASE_CURRENCY, type CurrencyCode } from "./money";

/** Kur mikro birimde saklanır: 1 birim döviz = rateMicro / 1e6 TL */
export const MICRO = 1_000_000;

export type RateMap = Map<string, number>;

/**
 * Verilen tarihte geçerli kurları döner — o gün kayıt yoksa
 * en son bilinen kur kullanılır (hafta sonu / tatil günleri için).
 */
export async function getRatesFor(date: ISODate = today()): Promise<RateMap> {
  const rows = await db
    .select()
    .from(exchangeRates)
    .where(lte(exchangeRates.date, date))
    .orderBy(desc(exchangeRates.date));

  const map: RateMap = new Map([[BASE_CURRENCY, MICRO]]);
  for (const row of rows) {
    // Sıralama tarihe göre azalan olduğu için ilk görülen en güncelidir.
    if (!map.has(row.code)) map.set(row.code, row.rateMicro);
  }
  return map;
}

export async function getRate(
  code: string,
  date: ISODate = today(),
): Promise<number | null> {
  if (code === BASE_CURRENCY) return MICRO;
  const row = await db
    .select()
    .from(exchangeRates)
    .where(and(eq(exchangeRates.code, code), lte(exchangeRates.date, date)))
    .orderBy(desc(exchangeRates.date))
    .limit(1);
  return row[0]?.rateMicro ?? null;
}

/**
 * Tutarı TL karşılığına çevirir.
 * Kur bilinmiyorsa null döner — arayüz bunu "kur girilmemiş" olarak gösterir.
 */
export function toTRY(
  amountMinor: number,
  currency: string,
  rates: RateMap,
): number | null {
  if (currency === BASE_CURRENCY) return amountMinor;
  const rate = rates.get(currency);
  if (!rate) return null;
  return Math.round((amountMinor * rate) / MICRO);
}

/** Kur bilinmiyorsa 0 sayar — toplamlarda kullanılır. */
export function toTRYOrZero(
  amountMinor: number,
  currency: string,
  rates: RateMap,
): number {
  return toTRY(amountMinor, currency, rates) ?? 0;
}

export async function setManualRate(
  code: string,
  date: ISODate,
  rateMicro: number,
): Promise<void> {
  await db
    .insert(exchangeRates)
    .values({ code, date, rateMicro, source: "manuel" })
    .onConflictDoUpdate({
      target: [exchangeRates.code, exchangeRates.date],
      set: { rateMicro, source: "manuel", fetchedAt: Date.now() },
    });
}

/* ──────────────────────────── TCMB kur çekme ──────────────────────────── */

const TCMB_URL = "https://www.tcmb.gov.tr/kurlar/today.xml";

/**
 * TCMB günlük kur bülteni. Döviz satış kuru referans alınır.
 * TCMB altın/gümüş gram fiyatı yayınlamadığı için XAU/XAG elle girilir.
 */
export async function fetchTcmbRates(): Promise<{
  date: ISODate;
  rates: Array<{ code: string; rateMicro: number }>;
} | null> {
  try {
    const res = await fetch(TCMB_URL, {
      headers: { "User-Agent": "MyFinance/1.0" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const xml = await res.text();

    const dateMatch = xml.match(/Tarih="(\d{2})\.(\d{2})\.(\d{4})"/);
    const date = dateMatch
      ? `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`
      : today();

    const wanted = new Set(["USD", "EUR", "GBP"]);
    const rates: Array<{ code: string; rateMicro: number }> = [];

    const blocks = xml.matchAll(/<Currency[^>]*Kod="([A-Z]{3})"[\s\S]*?<\/Currency>/g);
    for (const block of blocks) {
      const code = block[1];
      if (!wanted.has(code)) continue;

      const unit = Number(block[0].match(/<Unit>(\d+)<\/Unit>/)?.[1] ?? 1);
      const sellingRaw = block[0].match(/<ForexSelling>([\d.]+)<\/ForexSelling>/)?.[1];
      if (!sellingRaw) continue;

      const perUnit = Number(sellingRaw) / (unit || 1);
      if (!Number.isFinite(perUnit) || perUnit <= 0) continue;
      rates.push({ code, rateMicro: Math.round(perUnit * MICRO) });
    }

    return rates.length > 0 ? { date, rates } : null;
  } catch {
    return null;
  }
}

/** Kurları çekip veritabanına yazar; başarısız olursa sessizce geçer. */
export async function syncTcmbRates(): Promise<number> {
  const result = await fetchTcmbRates();
  if (!result) return 0;

  for (const { code, rateMicro } of result.rates) {
    await db
      .insert(exchangeRates)
      .values({ code, date: result.date, rateMicro, source: "tcmb" })
      .onConflictDoUpdate({
        target: [exchangeRates.code, exchangeRates.date],
        set: { rateMicro, source: "tcmb", fetchedAt: Date.now() },
      });
  }
  return result.rates.length;
}

export function formatRate(rateMicro: number): string {
  return (rateMicro / MICRO).toLocaleString("tr-TR", {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  });
}

export const RATE_CURRENCIES: CurrencyCode[] = ["USD", "EUR", "GBP", "XAU", "XAG"];
