import "server-only";

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { holdings as holdingsTable, quotes as quotesTable } from "@/db/schema";
import type { Holding, Quote } from "@/db/schema";
import { providerSymbol, quoteKey } from "../portfolio";
import { getSettings } from "../settings";
import { fetchFonolojiQuote } from "./fonoloji";
import type { FetchedQuote } from "./types";
import { fetchYahooQuote } from "./yahoo";

export { probeFonoloji } from "./fonoloji";
export type { FetchedQuote } from "./types";

/**
 * Fiyat önbelleği.
 *
 * Sayfa her açıldığında sağlayıcıya gitmek ücretsiz kotayı boşa harcar ve
 * sayfayı yavaşlatır. Bunun yerine fiyatın tazeliğine bakılır: TTL içindeyse
 * veritabanındaki değer kullanılır, değilse yenilenir. Kullanıcı "10-15 dakika
 * geriden gitse de olur" dediği için varsayılan 15 dakikadır.
 *
 * Bir sembol iki ayrı kalemde tutuluyorsa (aynı hisse, iki hesap) tek istek
 * atılır: önbellek anahtarı sağlayıcı + sembol.
 */

/** Aynı anda kaç sağlayıcı isteği açılsın. */
const CONCURRENCY = 4;

/** Hata alan bir sembol hemen tekrar denenmesin diye bekleme süresi. */
const ERROR_BACKOFF_MS = 5 * 60 * 1000;

export interface RefreshResult {
  fetched: number;
  cached: number;
  failed: number;
  errors: string[];
}

/** Bir kalemin fiyatının çekilmesi gereken sağlayıcı/sembol çifti. */
interface Target {
  key: string;
  provider: string;
  /** Sağlayıcıya gönderilecek sembol (BIST için .IS ekli). */
  symbol: string;
  /** Kullanıcının yazdığı sade kod. */
  rawSymbol: string;
  market: string;
}

function targetsOf(list: Holding[]): Target[] {
  const map = new Map<string, Target>();
  for (const h of list) {
    if (!h.isActive) continue;
    // Elle fiyat girilen kalem için sağlayıcıya gitmenin anlamı yok.
    if (h.provider === "manuel") continue;
    const key = quoteKey(h.provider, h.market, h.symbol);
    if (!map.has(key)) {
      map.set(key, {
        key,
        provider: h.provider,
        symbol: providerSymbol(h.market, h.symbol),
        rawSymbol: h.symbol.trim().toUpperCase(),
        market: h.market,
      });
    }
  }
  return [...map.values()];
}

/** Kayıtlı fiyatları anahtarlarına göre okur. */
export async function loadQuotes(): Promise<Map<string, Quote>> {
  const rows = await db.select().from(quotesTable);
  const map = new Map<string, Quote>();
  for (const row of rows) {
    map.set(`${row.provider}:${row.symbol}`, row);
  }
  return map;
}

/**
 * Bayatlamış fiyatları yeniler. `force` verilirse TTL'e bakılmaz.
 * Hiç istek gerekmiyorsa ağa çıkmaz — sayfa açılışını yavaşlatmaz.
 */
export async function refreshQuotes(options: {
  holdings?: Holding[];
  force?: boolean;
  now?: number;
}): Promise<RefreshResult> {
  const settings = await getSettings();
  const now = options.now ?? Date.now();
  const ttlMs = Math.max(1, settings.quoteTtlMinutes) * 60 * 1000;

  const list =
    options.holdings ?? (await db.select().from(holdingsTable));
  const targets = targetsOf(list);
  if (targets.length === 0) {
    return { fetched: 0, cached: 0, failed: 0, errors: [] };
  }

  const existing = await loadQuotes();

  const stale: Target[] = [];
  let cached = 0;
  for (const target of targets) {
    const current = existing.get(target.key);
    if (options.force || needsRefresh(current, now, ttlMs)) stale.push(target);
    else cached++;
  }

  if (stale.length === 0) {
    return { fetched: 0, cached, failed: 0, errors: [] };
  }

  const results = await runLimited(stale, CONCURRENCY, (target) =>
    fetchOne(target, settings.fonolojiApiKey),
  );

  let fetched = 0;
  let failed = 0;
  const errors: string[] = [];

  for (let i = 0; i < results.length; i++) {
    const target = stale[i];
    const result = results[i];

    if (result.ok) {
      fetched++;
      await upsertQuote({
        provider: target.provider,
        symbol: target.symbol,
        priceMicro: result.priceMicro,
        currency: result.currency,
        previousCloseMicro: result.previousCloseMicro,
        asOf: result.asOf,
        fetchedAt: now,
        error: null,
        rawSample: null,
      });
      // Sağlayıcı ismi bildirdiyse ve kullanıcı boş bıraktıysa doldur.
      if (result.name) await fillMissingNames(target, result.name);
    } else {
      failed++;
      errors.push(`${target.rawSymbol}: ${result.error}`);
      /* Hatada eski fiyat KORUNUR: bir kesinti yüzünden portföyün değeri
         sıfıra düşmesin. Sadece hata mesajı ve zaman damgası güncellenir. */
      const previous = existing.get(target.key);
      await upsertQuote({
        provider: target.provider,
        symbol: target.symbol,
        priceMicro: previous?.priceMicro ?? null,
        currency: previous?.currency ?? "TRY",
        previousCloseMicro: previous?.previousCloseMicro ?? null,
        asOf: previous?.asOf ?? null,
        fetchedAt: now,
        error: result.error,
        rawSample: result.rawSample ?? null,
      });
    }
  }

  return { fetched, cached, failed, errors };
}

function needsRefresh(quote: Quote | undefined, now: number, ttlMs: number): boolean {
  if (!quote) return true;
  const age = now - quote.fetchedAt;
  /* Hatalı kayıtlar için daha uzun beklenir: her sayfa açılışında çalışmayan
     bir sembole yeniden gitmek kotayı tüketir. */
  if (quote.error) return age > Math.max(ttlMs, ERROR_BACKOFF_MS);
  if (quote.priceMicro == null) return true;
  return age > ttlMs;
}

async function fetchOne(target: Target, apiKey: string): Promise<FetchedQuote> {
  switch (target.provider) {
    case "yahoo":
      return fetchYahooQuote(target.symbol);
    case "fonoloji":
      return fetchFonolojiQuote(target.symbol, apiKey);
    default:
      return {
        symbol: target.symbol,
        ok: false,
        error: `Bilinmeyen sağlayıcı: ${target.provider}`,
      };
  }
}

async function upsertQuote(row: {
  provider: string;
  symbol: string;
  priceMicro: number | null;
  currency: string;
  previousCloseMicro: number | null;
  asOf: string | null;
  fetchedAt: number;
  error: string | null;
  rawSample: string | null;
}): Promise<void> {
  await db
    .insert(quotesTable)
    .values(row)
    .onConflictDoUpdate({
      target: [quotesTable.provider, quotesTable.symbol],
      set: {
        priceMicro: row.priceMicro,
        currency: row.currency,
        previousCloseMicro: row.previousCloseMicro,
        asOf: row.asOf,
        fetchedAt: row.fetchedAt,
        error: row.error,
        rawSample: row.rawSample,
      },
    });
}

/** Kullanıcı ismi boş bıraktıysa sağlayıcının bildirdiği isimle doldurur. */
async function fillMissingNames(target: Target, name: string): Promise<void> {
  await db
    .update(holdingsTable)
    .set({ name })
    .where(
      and(
        eq(holdingsTable.provider, target.provider),
        eq(holdingsTable.symbol, target.rawSymbol),
        eq(holdingsTable.name, ""),
      ),
    );
}

/**
 * Görevleri en fazla `limit` tanesi aynı anda çalışacak şekilde yürütür.
 * Sonuç dizisi girdi sırasını korur.
 */
async function runLimited<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  async function pump(): Promise<void> {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await worker(items[index]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => pump()),
  );
  return results;
}
