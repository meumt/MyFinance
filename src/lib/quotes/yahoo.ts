import { pickDate, pickNumber, rawSampleOf, toPriceMicro, type Json } from "./parse";
import { RATE_LIMIT_PREFIX, type FetchedQuote } from "./types";

/**
 * Yahoo Finance grafik uç noktası.
 *
 * `/v8/finance/chart/<sembol>` anahtar istemez ve hem NASDAQ (AAPL) hem Borsa
 * İstanbul (THYAO.IS) sembollerini kapsar. Eski `/v7/finance/quote` uç noktası
 * çerez + crumb istediği için kullanılmaz.
 *
 * Veri 15 dakikaya kadar gecikmeli olabilir; portföy takibi için yeterli.
 *
 * HIZ SINIRI: Yahoo kısa sürede gelen istekleri IP bazında 429 ile geri
 * çevirir. Buna karşı üç şey yapılır:
 *  1. İstekler tarayıcı başlıklarıyla gönderilir (başlıksız istek daha çabuk
 *     sınırlanır),
 *  2. 429 alınırsa kısa bir bekleyişle ikinci sunucu (query2) denenir —
 *     sınırlama çoğu zaman tek sunucuya özgüdür,
 *  3. Yine olmazsa hata `RATE_LIMIT_PREFIX` ile işaretlenir; çağıran katman
 *     o sembolü uzun süre yeniden denemez.
 */

const HOSTS = [
  "https://query1.finance.yahoo.com",
  "https://query2.finance.yahoo.com",
];

/** Tarayıcı görünümlü başlıklar — çıplak istekler daha çabuk sınırlanıyor. */
const HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  Accept: "application/json,text/plain,*/*",
  "Accept-Language": "tr-TR,tr;q=0.9,en;q=0.8",
  Referer: "https://finance.yahoo.com/",
};

export async function fetchYahooQuote(
  symbol: string,
  timeoutMs = 15_000,
): Promise<FetchedQuote> {
  let lastError = `Yahoo yanıt vermedi: ${symbol}`;

  for (let attempt = 0; attempt < HOSTS.length; attempt++) {
    /* İkinci denemeden önce kısa bir nefes: sınırlama anlıksa geçer. */
    if (attempt > 0) await sleep(700);

    const url = `${HOSTS[attempt]}/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`;

    let res: Response;
    try {
      res = await fetch(url, {
        headers: HEADERS,
        signal: AbortSignal.timeout(timeoutMs),
        cache: "no-store",
      });
    } catch (error) {
      lastError =
        error instanceof Error ? `Bağlantı: ${error.message}` : "Bağlantı hatası";
      continue;
    }

    if (res.status === 429) {
      lastError = `${RATE_LIMIT_PREFIX}: Yahoo çok fazla istek aldı (429). Fiyat bir süre sonra kendiliğinden yenilenecek.`;
      continue;
    }

    if (res.status === 404) {
      // Sembol yoksa başka sunucu da bulamaz; boşuna deneme.
      return { symbol, ok: false, error: `Sembol bulunamadı: ${symbol}` };
    }

    if (!res.ok) {
      lastError = `Yahoo HTTP ${res.status}`;
      continue;
    }

    try {
      return parseYahooBody((await res.json()) as Json, symbol);
    } catch {
      return { symbol, ok: false, error: "Yanıt JSON değil" };
    }
  }

  return { symbol, ok: false, error: lastError };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Yanıt gövdesini okur. Ağdan ayrıldı ki gerçek bir Yahoo yanıtıyla
 * test edilebilsin — fiyat ayrıştırması hata yapmaya en açık yer.
 */
export function parseYahooBody(body: Json, symbol: string): FetchedQuote {
  /* Yahoo hatayı 200 gövdesinde de bildirebiliyor. */
  const apiError = readError(body);
  if (apiError) return { symbol, ok: false, error: apiError };

  const meta = readPath(body, "chart.result.meta");

  /* Sıra önemli: seans içinde `regularMarketPrice` doğru olandır. Seans
     kapalıysa o alan olmayabilir, son kapanışa düşülür. */
  const price = pickNumber(meta, [
    "regularMarketPrice",
    "previousClose",
    "chartPreviousClose",
  ]);

  /* Sıfır ya da negatif fiyat geçerli bir kotasyon değildir; `toPriceMicro`
     bunları null yapar. Buradan geçirilirse `ok: true` ile fiyatsız bir sonuç
     doğar ve portföy sessizce sıfırlanır. */
  const priceMicro = toPriceMicro(price);
  if (priceMicro === null) {
    return {
      symbol,
      ok: false,
      error: price === null ? "Fiyat alanı bulunamadı" : `Geçersiz fiyat: ${price}`,
      rawSample: rawSampleOf(body),
    };
  }

  const previousClose = pickNumber(meta, ["chartPreviousClose", "previousClose"]);

  const rawCurrency = readPath(meta, "currency");
  const currency =
    typeof rawCurrency === "string" && rawCurrency.length > 0
      ? rawCurrency.toUpperCase()
      : "TRY";

  const longName = readPath(meta, "longName");
  const shortName = readPath(meta, "shortName");
  const name =
    typeof longName === "string" && longName.length > 0
      ? longName
      : typeof shortName === "string" && shortName.length > 0
        ? shortName
        : null;

  return {
    symbol,
    ok: true,
    priceMicro,
    /* Önceki kapanış fiyatın kendisiyle aynıysa değişim hesaplanamaz;
       null bırakılır ki arayüz %0 diye yanlış bir şey göstermesin. */
    previousCloseMicro:
      previousClose !== null && previousClose !== price
        ? toPriceMicro(previousClose)
        : null,
    currency,
    asOf: pickDate(meta, ["regularMarketTime"]),
    name,
  };
}

function readPath(root: Json, path: string): Json {
  let current: Json = root;
  for (const part of path.split(".")) {
    if (Array.isArray(current)) current = current[0];
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Record<string, Json>)[part];
  }
  return current;
}

function readError(body: Json): string | null {
  const description = readPath(body, "chart.error.description");
  if (typeof description === "string" && description.length > 0) return description;
  const code = readPath(body, "chart.error.code");
  if (typeof code === "string" && code.length > 0) return code;
  return null;
}
