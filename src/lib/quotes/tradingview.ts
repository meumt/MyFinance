import { toPriceMicro, toNumber, rawSampleOf, type Json } from "./parse";
import { RATE_LIMIT_PREFIX, type FetchedQuote } from "./types";

/**
 * TradingView tarayıcı (scanner) uç noktası.
 *
 * Anahtar ve oturum istemez, TOPLU çalışır: portföydeki bütün BIST hisseleri
 * tek POST ile gelir. Hız sınırı sorununun asıl çaresi budur — 20 sembol için
 * 20 istek yerine 1 istek.
 *
 * Veri 15 dakika gecikmelidir; portföy takibi için yeterli.
 *
 * İstek:
 *   POST https://scanner.tradingview.com/turkey/scan
 *   { "symbols": { "tickers": ["BIST:THYAO"], "query": { "types": [] } },
 *     "columns": ["close", "change", "currency", "description"] }
 *
 * Yanıt:
 *   { "totalCount": 1,
 *     "data": [ { "s": "BIST:THYAO", "d": [312.75, -1.36, "TRY", "TURK HAVA YOLLARI"] } ] }
 *
 * Sütunların SIRASI istekte gönderdiğimiz sırayla aynıdır; `d` dizisi ona
 * göre okunur. Sıra kayarsa fiyat uydurulmaz, hata dönülür.
 */

const COLUMNS = ["close", "change", "currency", "description"] as const;

/**
 * Pazar → tarayıcı yolu ve olası borsa önekleri.
 *
 * Tarayıcı `BORSA:SEMBOL` biçimi ister; çıplak sembol boş döner. ABD'de
 * hissenin NASDAQ'ta mı NYSE'de mi işlem gördüğü önceden bilinmediği için
 * hepsi birden sorulur — tek istek olduğu için maliyeti yok, yanıt sade koda
 * göre eşlendiğinden hangisi dönerse o kullanılır.
 */
const MARKET_SCOPE: Record<string, { path: string; prefixes: string[] }> = {
  bist: { path: "turkey", prefixes: ["BIST"] },
  nasdaq: { path: "america", prefixes: ["NASDAQ", "NYSE", "AMEX"] },
};

/** Bir istekte kaç sembol sorulabilir. */
export const TRADINGVIEW_BATCH = 40;

export async function fetchTradingViewQuotes(
  market: string,
  symbols: string[],
  timeoutMs = 15_000,
): Promise<FetchedQuote[]> {
  const scope = MARKET_SCOPE[market];
  if (!scope) {
    return symbols.map((symbol) => ({
      symbol,
      ok: false,
      error: `TradingView bu pazarı desteklemiyor: ${market}`,
    }));
  }

  const tickers = symbols.flatMap((symbol) =>
    scope.prefixes.map((prefix) => `${prefix}:${symbol}`),
  );

  let res: Response;
  try {
    res = await fetch(`https://scanner.tradingview.com/${scope.path}/scan`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      },
      body: JSON.stringify({
        symbols: { tickers, query: { types: [] } },
        columns: COLUMNS,
      }),
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
  } catch (error) {
    const message =
      error instanceof Error ? `Bağlantı: ${error.message}` : "Bağlantı hatası";
    return symbols.map((symbol) => ({ symbol, ok: false, error: message }));
  }

  if (res.status === 429) {
    return symbols.map((symbol) => ({
      symbol,
      ok: false,
      error: `${RATE_LIMIT_PREFIX}: TradingView çok fazla istek aldı (429).`,
    }));
  }

  if (!res.ok) {
    return symbols.map((symbol) => ({
      symbol,
      ok: false,
      error: `TradingView HTTP ${res.status}`,
    }));
  }

  let body: Json;
  try {
    body = (await res.json()) as Json;
  } catch {
    return symbols.map((symbol) => ({
      symbol,
      ok: false,
      error: "TradingView yanıtı JSON değil",
    }));
  }

  return parseTradingViewBody(body, symbols);
}

/**
 * Yanıt gövdesini sembollere dağıtır. Ağdan ayrıldı ki gerçek bir yanıtla
 * test edilebilsin.
 *
 * İstenen ama yanıtta bulunmayan sembol için fiyat UYDURULMAZ; o sembol
 * hatayla döner ve zincirdeki sonraki kaynağa devredilir.
 */
export function parseTradingViewBody(
  body: Json,
  symbols: string[],
): FetchedQuote[] {
  const rows =
    typeof body === "object" && body !== null && Array.isArray((body as { data?: Json }).data)
      ? ((body as { data: Json[] }).data as Json[])
      : null;

  if (!rows) {
    return symbols.map((symbol) => ({
      symbol,
      ok: false,
      error: "TradingView yanıtında 'data' dizisi yok",
      rawSample: rawSampleOf(body),
    }));
  }

  /* Yanıtı sembole göre indeksle. Dönen `s` alanı "BIST:THYAO" biçimindedir;
     önek atılarak kullanıcının yazdığı koda eşlenir. */
  const bySymbol = new Map<string, Json[]>();
  for (const row of rows) {
    if (typeof row !== "object" || row === null) continue;
    const record = row as { s?: unknown; d?: unknown };
    if (typeof record.s !== "string" || !Array.isArray(record.d)) continue;
    const code = record.s.includes(":") ? record.s.split(":")[1] : record.s;
    bySymbol.set(code.toUpperCase(), record.d as Json[]);
  }

  return symbols.map((symbol): FetchedQuote => {
    const values = bySymbol.get(symbol.toUpperCase());
    if (!values) {
      return {
        symbol,
        ok: false,
        error: `TradingView bu sembolü döndürmedi: ${symbol}`,
      };
    }

    // Sütun sırası istekteki COLUMNS ile aynıdır.
    const close = toNumber(values[0] ?? null);
    const changePercent = toNumber(values[1] ?? null);
    const currencyRaw = values[2];
    const description = values[3];

    const priceMicro = toPriceMicro(close);
    if (priceMicro === null) {
      return {
        symbol,
        ok: false,
        error:
          close === null
            ? "TradingView fiyat alanı boş"
            : `Geçersiz fiyat: ${close}`,
        rawSample: rawSampleOf(values),
      };
    }

    /* Önceki kapanış, yüzde değişimden türetilir: önceki = güncel / (1 + %/100).
       Değişim sıfırsa uydurma bir "%0" üretilmez. */
    let previousCloseMicro: number | null = null;
    if (changePercent !== null && changePercent !== 0) {
      const factor = 1 + changePercent / 100;
      if (factor > 0) previousCloseMicro = toPriceMicro(close! / factor);
    }

    return {
      symbol,
      ok: true,
      priceMicro,
      previousCloseMicro,
      currency:
        typeof currencyRaw === "string" && currencyRaw.length > 0
          ? currencyRaw.toUpperCase()
          : "TRY",
      // Tarayıcı değerleme günü vermez; fiyat "şu an"a aittir.
      asOf: null,
      name: typeof description === "string" && description.length > 0 ? description : null,
    };
  });
}
