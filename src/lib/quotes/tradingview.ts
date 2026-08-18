import { toPriceMicro, toNumber, rawSampleOf, type Json } from "./parse";
import {
  RATE_LIMIT_PREFIX,
  type ExtendedSessionQuote,
  type FetchedQuote,
} from "./types";

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

/** Her pazarda istenen temel sütunlar. */
const BASE_COLUMNS = ["close", "change", "currency", "description"] as const;

/**
 * ABD hisselerinde ek olarak istenen seans dışı sütunları.
 *
 * `close` yalnızca NORMAL seansın fiyatıdır. ABD borsalarında normal seans
 * Türkiye saatiyle 16:30-23:00 arasıdır; gündüz görülen hareketin çoğu
 * seans öncesidir ve `close`'a hiç yansımaz.
 *
 * TradingView'e göre bu alanlar yalnızca ilgili seans sürerken dolar:
 * seans sonrası alanları normal seans başlamadan önce boştur, seans öncesi
 * alanları da yeni bir seans öncesi başlayınca sıfırlanır. Yani null gelmesi
 * normaldir, hata değildir.
 */
const EXTENDED_COLUMNS = [
  "premarket_close",
  "premarket_change",
  "postmarket_close",
  "postmarket_change",
] as const;

/**
 * Pazar → tarayıcı yolu ve olası borsa önekleri.
 *
 * Tarayıcı `BORSA:SEMBOL` biçimi ister; çıplak sembol boş döner. ABD'de
 * hissenin NASDAQ'ta mı NYSE'de mi işlem gördüğü önceden bilinmediği için
 * hepsi birden sorulur — tek istek olduğu için maliyeti yok, yanıt sade koda
 * göre eşlendiğinden hangisi dönerse o kullanılır.
 */
const MARKET_SCOPE: Record<
  string,
  { path: string; prefixes: string[]; extendedHours: boolean }
> = {
  bist: { path: "turkey", prefixes: ["BIST"], extendedHours: false },
  nasdaq: {
    path: "america",
    prefixes: ["NASDAQ", "NYSE", "AMEX"],
    extendedHours: true,
  },
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

  /* ABD'de önce seans dışı sütunlarla denenir. Sütun adları tarayıcının
     sözlüğünde yoksa TradingView isteği tümden reddeder; o durumda temel
     sütunlarla tek bir kez daha denenir. Böylece seans dışı desteği hiçbir
     koşulda mevcut çalışan davranışı bozamaz. */
  const attempts: Array<readonly string[]> = scope.extendedHours
    ? [[...BASE_COLUMNS, ...EXTENDED_COLUMNS], BASE_COLUMNS]
    : [BASE_COLUMNS];

  let lastError = "TradingView yanıt vermedi";

  for (const columns of attempts) {
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
          columns,
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
      // 400/422 genelde tanınmayan sütun demektir; sade istekle tekrar denenir.
      lastError = `TradingView HTTP ${res.status}`;
      continue;
    }

    let body: Json;
    try {
      body = (await res.json()) as Json;
    } catch {
      lastError = "TradingView yanıtı JSON değil";
      continue;
    }

    return parseTradingViewBody(body, symbols, columns);
  }

  return symbols.map((symbol) => ({ symbol, ok: false, error: lastError }));
}

/**
 * Seans dışı fiyatı okur.
 *
 * Seans sonrası, seans öncesine tercih edilir: ikisi birden doluysa daha
 * yeni olan seans sonrasıdır (normal seans kapandıktan sonra gelen veri).
 * İkisi de boşsa null döner — bu hata değil, o an seans dışı işlem
 * olmadığı anlamına gelir.
 */
function readExtended(at: (name: string) => Json): ExtendedSessionQuote | null {
  const candidates: Array<{
    session: "sonrasi" | "oncesi";
    price: number | null;
    change: number | null;
  }> = [
    {
      session: "sonrasi",
      price: toNumber(at("postmarket_close")),
      change: toNumber(at("postmarket_change")),
    },
    {
      session: "oncesi",
      price: toNumber(at("premarket_close")),
      change: toNumber(at("premarket_change")),
    },
  ];

  for (const candidate of candidates) {
    const priceMicro = toPriceMicro(candidate.price);
    if (priceMicro === null) continue;
    return {
      priceMicro,
      // Yüzdeyi baz puana çevir: %0,42 → 42
      changeBps:
        candidate.change === null ? null : Math.round(candidate.change * 100),
      session: candidate.session,
    };
  }

  return null;
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
  columns: readonly string[] = BASE_COLUMNS,
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

    /* `d` dizisi istekte gönderilen sütun sırasını izler; konumlar sabit
       varsayılmaz, istenen listeden okunur. Sütun istenmemişse -1 döner ve
       değer null kalır. */
    const at = (name: string): Json => {
      const index = columns.indexOf(name);
      return index >= 0 ? (values[index] ?? null) : null;
    };

    const close = toNumber(at("close"));
    const changePercent = toNumber(at("change"));
    const currencyRaw = at("currency");
    const description = at("description");

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
      extended: readExtended(at),
    };
  });
}
