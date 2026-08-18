import "server-only";

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { holdings as holdingsTable, quotes as quotesTable } from "@/db/schema";
import type { Holding, Quote } from "@/db/schema";
import {
  cleanSymbol,
  MARKET_CHAIN,
  quoteKey,
  type Market,
  type Provider,
} from "../portfolio";
import { getSettings } from "../settings";
import { fetchFonolojiQuote } from "./fonoloji";
import { fetchStooqQuotes, STOOQ_BATCH } from "./stooq";
import { fetchTradingViewQuotes, TRADINGVIEW_BATCH } from "./tradingview";
import { RATE_LIMIT_PREFIX, type FetchedQuote } from "./types";
import { fetchYahooQuote } from "./yahoo";

export { probeFonoloji } from "./fonoloji";
export type { FetchedQuote } from "./types";

/**
 * Fiyat önbelleği ve sağlayıcı zinciri.
 *
 * İki ilke:
 *
 * 1. TAZELİK — Sayfa her açıldığında sağlayıcıya gitmek kotayı harcar ve
 *    sayfayı yavaşlatır. Fiyat TTL içindeyse veritabanındaki değer kullanılır.
 *
 * 2. ZİNCİR — Her pazarın sıralı kaynak listesi vardır (`MARKET_CHAIN`).
 *    Bir kaynak sembolü veremezse sıradaki devralır. Böylece tek bir servisin
 *    kapanması portföyün o kısmını kör bırakmaz.
 *
 * Önbellek anahtarı pazar + sembol olduğu için kaynak değiştiğinde ikinci bir
 * satır oluşmaz; fiyatı gerçekte kimin verdiği `source` alanında durur.
 */

/** Toplu çalışamayan sağlayıcılarda aynı anda kaç istek. */
const CONCURRENCY = 2;

/** Tek tek giden istekler arasına konan nefes. */
const STAGGER_MS = 250;

/**
 * Sayfa açılışını kilitlememek için toplam süre bütçesi.
 *
 * Zincirin tamamına yetecek kadar geniş tutulur: bütçe bir kaynağın
 * ortasında dolarsa yedekler hiç denenmez ve kullanıcı "fiyat yok" görür
 * — oysa yedek çalışacaktı. Tek tek istek atan kaynakların zaman aşımları
 * bu bütçeye sığacak şekilde kısaltıldı.
 */
const BUDGET_MS = 20_000;

/** Hata alan bir sembol hemen tekrar denenmesin diye bekleme süresi. */
const ERROR_BACKOFF_MS = 5 * 60 * 1000;

/** Hız sınırına takılan sembol için çok daha uzun bekleyiş. */
const RATE_LIMIT_BACKOFF_MS = 30 * 60 * 1000;

export interface RefreshResult {
  fetched: number;
  cached: number;
  failed: number;
  errors: string[];
  /** Hangi kaynaktan kaç fiyat geldi — teşhis için. */
  bySource: Record<string, number>;
}

/** Fiyatı çekilecek bir kalem: pazar + sade sembol. */
interface Target {
  key: string;
  market: string;
  symbol: string;
  /** Kullanıcı bu kalem için belirli bir kaynak seçtiyse. */
  forcedProvider: Provider | null;
}

function targetsOf(list: Holding[]): Target[] {
  const map = new Map<string, Target>();
  for (const h of list) {
    if (!h.isActive) continue;
    // Elle fiyat girilen kalem için sağlayıcıya gitmenin anlamı yok.
    if (h.provider === "manuel") continue;

    const key = quoteKey(h.market, h.symbol);
    if (map.has(key)) continue;

    const forced =
      h.provider && h.provider !== "otomatik" ? (h.provider as Provider) : null;

    map.set(key, {
      key,
      market: h.market,
      symbol: cleanSymbol(h.symbol),
      forcedProvider: forced,
    });
  }
  return [...map.values()];
}

/** Kayıtlı fiyatları anahtarlarına göre okur. */
export async function loadQuotes(): Promise<Map<string, Quote>> {
  const rows = await db.select().from(quotesTable);
  return new Map(rows.map((row) => [`${row.market}:${row.symbol}`, row]));
}

/**
 * Bayatlamış fiyatları yeniler. `force` verilirse TTL'e bakılmaz.
 * Hiç istek gerekmiyorsa ağa çıkmaz.
 */
export async function refreshQuotes(options: {
  holdings?: Holding[];
  force?: boolean;
  now?: number;
}): Promise<RefreshResult> {
  const settings = await getSettings();
  const now = options.now ?? Date.now();
  const ttlMs = Math.max(1, settings.quoteTtlMinutes) * 60 * 1000;
  const empty: RefreshResult = {
    fetched: 0,
    cached: 0,
    failed: 0,
    errors: [],
    bySource: {},
  };

  const list = options.holdings ?? (await db.select().from(holdingsTable));
  const targets = targetsOf(list);
  if (targets.length === 0) return empty;

  const existing = await loadQuotes();

  const stale: Target[] = [];
  let cached = 0;
  for (const target of targets) {
    if (options.force || needsRefresh(existing.get(target.key), now, ttlMs)) {
      stale.push(target);
    } else {
      cached++;
    }
  }
  if (stale.length === 0) return { ...empty, cached };

  const deadline = now + BUDGET_MS;
  const resolved = new Map<string, { result: FetchedQuote; source: Provider }>();
  /** Sembol → zincirdeki her kaynağın hata mesajı. */
  const failures = new Map<string, string[]>();
  /** Sembol → ayrıştırılamayan son yanıtın ham örneği (alan adı teşhisi için). */
  const rawSamples = new Map<string, string>();

  /* Pazarlara ayır; her pazarın kendi zinciri sırayla denenir. */
  const byMarket = new Map<string, Target[]>();
  for (const target of stale) {
    const bucket = byMarket.get(target.market) ?? [];
    bucket.push(target);
    byMarket.set(target.market, bucket);
  }

  for (const [market, marketTargets] of byMarket) {
    /* Kullanıcı bir kalem için kaynak seçtiyse zincir yerine o kullanılır. */
    const groups = new Map<string, Target[]>();
    for (const target of marketTargets) {
      const chainKey = target.forcedProvider ?? "__chain__";
      const bucket = groups.get(chainKey) ?? [];
      bucket.push(target);
      groups.set(chainKey, bucket);
    }

    for (const [chainKey, groupTargets] of groups) {
      const chain: Provider[] =
        chainKey === "__chain__"
          ? (MARKET_CHAIN[market as Market] ?? [])
          : [chainKey as Provider];

      let pending = groupTargets;

      for (const provider of chain) {
        if (pending.length === 0) break;
        if (Date.now() > deadline) break;

        const results = await runProvider(
          provider,
          market,
          pending,
          settings.fonolojiApiKey,
          deadline,
        );

        const stillPending: Target[] = [];
        for (const target of pending) {
          const result = results.get(target.symbol.toUpperCase());
          if (!result) {
            // Bütçe yüzünden denenmedi; sıradaki kaynağa da gitmesin.
            stillPending.push(target);
            continue;
          }

          if (result.ok) {
            resolved.set(target.key, { result, source: provider });
            continue;
          }

          /* Başarısız. Zincirdeki HER denemenin hatası biriktirilir: yalnızca
             ilkini saklamak "Stooq 404" yazıp yedeklerin çalışıp çalışmadığını
             gizliyordu, oysa asıl soru zincirin nerede koptuğu. */
          failures.set(target.key, [
            ...(failures.get(target.key) ?? []),
            `${provider}: ${result.error}`,
          ]);
          /* Ham örnek yalnızca ayrıştırma başarısız olduğunda gelir; gerçek
             alan adını görmenin tek yolu bu, kaybolmamalı. */
          if (result.rawSample) rawSamples.set(target.key, result.rawSample);
          stillPending.push(target);
        }
        pending = stillPending;
      }
    }
  }

  /* Sonuçları yaz. */
  let fetched = 0;
  let failed = 0;
  const errors: string[] = [];
  const bySource: Record<string, number> = {};

  for (const target of stale) {
    const entry = resolved.get(target.key);
    const chainErrors = failures.get(target.key);

    // Ne başarı ne hata: bütçe dolduğu için hiç denenmedi, kayda dokunma.
    if (!entry && !chainErrors) continue;

    const previous = existing.get(target.key);

    if (entry?.result.ok) {
      fetched++;
      bySource[entry.source] = (bySource[entry.source] ?? 0) + 1;
      await upsertQuote({
        market: target.market,
        symbol: target.symbol,
        source: entry.source,
        priceMicro: entry.result.priceMicro,
        currency: entry.result.currency,
        previousCloseMicro: entry.result.previousCloseMicro,
        extendedPriceMicro: entry.result.extended?.priceMicro ?? null,
        extendedChangeBps: entry.result.extended?.changeBps ?? null,
        extendedSession: entry.result.extended?.session ?? null,
        asOf: entry.result.asOf,
        fetchedAt: now,
        error: null,
        rawSample: null,
      });
      if (entry.result.name) await fillMissingNames(target, entry.result.name);
    } else {
      failed++;
      /* Tüm zincirin hatası tek satırda: hangi kaynağın neden düştüğü
         görülmeden sorun teşhis edilemiyor. */
      const message = (chainErrors ?? []).join(" · ") || "Fiyat alınamadı";
      errors.push(`${target.symbol}: ${message}`);

      /* Hatada eski fiyat KORUNUR: bir kesinti yüzünden portföyün değeri
         sıfıra düşmesin. Sadece hata ve zaman damgası güncellenir. */
      await upsertQuote({
        market: target.market,
        symbol: target.symbol,
        source: previous?.source ?? null,
        priceMicro: previous?.priceMicro ?? null,
        currency: previous?.currency ?? "TRY",
        previousCloseMicro: previous?.previousCloseMicro ?? null,
        extendedPriceMicro: previous?.extendedPriceMicro ?? null,
        extendedChangeBps: previous?.extendedChangeBps ?? null,
        extendedSession: previous?.extendedSession ?? null,
        asOf: previous?.asOf ?? null,
        fetchedAt: now,
        error: message,
        rawSample: rawSamples.get(target.key) ?? null,
      });
    }
  }

  return { fetched, cached, failed, errors, bySource };
}

/**
 * Bir sağlayıcıyı verilen semboller için çalıştırır.
 * Toplu çalışabilen sağlayıcılar parti parti, diğerleri seyreltilmiş tek
 * tek gider. Dönen harita sembol (büyük harf) → sonuç.
 */
async function runProvider(
  provider: Provider,
  market: string,
  targets: Target[],
  fonolojiApiKey: string,
  deadline: number,
): Promise<Map<string, FetchedQuote>> {
  const out = new Map<string, FetchedQuote>();
  const symbols = targets.map((t) => t.symbol);

  const record = (results: FetchedQuote[]) => {
    for (const result of results) out.set(result.symbol.toUpperCase(), result);
  };

  if (provider === "tradingview") {
    for (const batch of chunk(symbols, TRADINGVIEW_BATCH)) {
      if (Date.now() > deadline) break;
      record(await fetchTradingViewQuotes(market, batch));
    }
    return out;
  }

  if (provider === "stooq") {
    for (const batch of chunk(symbols, STOOQ_BATCH)) {
      if (Date.now() > deadline) break;
      record(await fetchStooqQuotes(batch));
    }
    return out;
  }

  /* Tek tek çalışan sağlayıcılar. */
  const single = async (symbol: string): Promise<FetchedQuote> => {
    if (provider === "fonoloji") return fetchFonolojiQuote(symbol, fonolojiApiKey);
    if (provider === "yahoo") {
      // Yahoo Borsa İstanbul sembollerinde `.IS` ekini ister.
      const yahooSymbol = market === "bist" ? `${symbol}.IS` : symbol;
      const result = await fetchYahooQuote(yahooSymbol, 8_000);
      // Sonuç sade kodla eşlensin.
      return { ...result, symbol };
    }
    return { symbol, ok: false, error: `Bilinmeyen sağlayıcı: ${provider}` };
  };

  const results = await runLimited(symbols, CONCURRENCY, deadline, single);
  record(results.filter((r): r is FetchedQuote => r !== undefined));
  return out;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function needsRefresh(quote: Quote | undefined, now: number, ttlMs: number): boolean {
  if (!quote) return true;
  const age = now - quote.fetchedAt;

  /* Hız sınırına takılmışsa uzun süre dokunulmaz — ısrar sınırı uzatır. */
  if (quote.error?.startsWith(RATE_LIMIT_PREFIX)) {
    return age > Math.max(ttlMs, RATE_LIMIT_BACKOFF_MS);
  }
  if (quote.error) return age > Math.max(ttlMs, ERROR_BACKOFF_MS);

  if (quote.priceMicro == null) return true;
  return age > ttlMs;
}

async function upsertQuote(row: {
  market: string;
  symbol: string;
  source: string | null;
  priceMicro: number | null;
  currency: string;
  previousCloseMicro: number | null;
  extendedPriceMicro: number | null;
  extendedChangeBps: number | null;
  extendedSession: string | null;
  asOf: string | null;
  fetchedAt: number;
  error: string | null;
  rawSample: string | null;
}): Promise<void> {
  await db
    .insert(quotesTable)
    .values(row)
    .onConflictDoUpdate({
      target: [quotesTable.market, quotesTable.symbol],
      set: {
        source: row.source,
        priceMicro: row.priceMicro,
        currency: row.currency,
        previousCloseMicro: row.previousCloseMicro,
        extendedPriceMicro: row.extendedPriceMicro,
        extendedChangeBps: row.extendedChangeBps,
        extendedSession: row.extendedSession,
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
        eq(holdingsTable.market, target.market),
        eq(holdingsTable.symbol, target.symbol),
        eq(holdingsTable.name, ""),
      ),
    );
}

/**
 * Görevleri en fazla `limit` tanesi aynı anda, aralarında nefes bırakarak
 * yürütür. `deadline` geçtiğinde kalanlara dokunulmaz ve o gözler `undefined`
 * kalır — çağıran bunu "denenmedi" diye okur.
 */
async function runLimited<T, R>(
  items: T[],
  limit: number,
  deadline: number,
  worker: (item: T) => Promise<R>,
): Promise<Array<R | undefined>> {
  const results = new Array<R | undefined>(items.length);
  let cursor = 0;

  async function pump(): Promise<void> {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      if (Date.now() > deadline) return;

      results[index] = await worker(items[index]);
      if (STAGGER_MS > 0) await sleep(STAGGER_MS);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => pump()),
  );
  return results;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
