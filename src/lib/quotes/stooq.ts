import { toNumber, toISODate, toPriceMicro } from "./parse";
import { RATE_LIMIT_PREFIX, type FetchedQuote } from "./types";

/**
 * Stooq — ABD hisseleri için anahtarsız CSV kaynağı.
 *
 * Toplu çalışır: semboller `+` ile birleştirilir, tek istekte hepsi gelir.
 * Yahoo'ya göre çok daha az sınırlama uygular ve oturum/çerez istemez.
 *
 * İstek:
 *   GET https://stooq.com/q/l/?s=aapl.us+msft.us&f=sd2t2ohlcv&h&e=csv
 *
 * Yanıt:
 *   Symbol,Date,Time,Open,High,Low,Close,Volume
 *   AAPL.US,2026-08-17,22:00:07,230.5,233.1,229.8,232.87,45000000
 *
 * Bilinmeyen sembolde alanlar `N/D` gelir — bu fiyat değildir, hata olarak
 * işaretlenir ve zincirdeki sonraki kaynağa devredilir.
 *
 * Stooq önceki kapanışı vermez; günlük değişim bu kaynaktan hesaplanamaz ve
 * `previousCloseMicro` null bırakılır (arayüz "bilinmiyor" der, %0 demez).
 */

/** Bir istekte kaç sembol. */
export const STOOQ_BATCH = 20;

/** ABD sembolleri Stooq'ta `.us` sonekiyle aranır. */
function stooqSymbol(symbol: string): string {
  const clean = symbol.trim().toLowerCase();
  return clean.endsWith(".us") ? clean : `${clean}.us`;
}

export async function fetchStooqQuotes(
  symbols: string[],
  timeoutMs = 15_000,
): Promise<FetchedQuote[]> {
  const query = symbols.map(stooqSymbol).join("+");
  const url = `https://stooq.com/q/l/?s=${encodeURIComponent(query)}&f=sd2t2ohlcv&h&e=csv`;

  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        Accept: "text/csv,text/plain,*/*",
        "User-Agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      },
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
      error: `${RATE_LIMIT_PREFIX}: Stooq çok fazla istek aldı (429).`,
    }));
  }

  if (!res.ok) {
    return symbols.map((symbol) => ({
      symbol,
      ok: false,
      error: `Stooq HTTP ${res.status}`,
    }));
  }

  return parseStooqCsv(await res.text(), symbols);
}

/**
 * CSV'yi sembollere dağıtır. Ağdan ayrıldı ki gerçek bir yanıtla test
 * edilebilsin.
 */
export function parseStooqCsv(csv: string, symbols: string[]): FetchedQuote[] {
  const lines = csv
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length < 2) {
    return symbols.map((symbol) => ({
      symbol,
      ok: false,
      error: "Stooq boş yanıt döndürdü",
      rawSample: csv.slice(0, 300),
    }));
  }

  /* Başlık satırından sütun konumları okunur; Stooq alan sırasını istekteki
     `f` parametresine göre kurar, sabit varsaymak kırılgan olurdu. */
  const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const indexOf = (name: string) => header.indexOf(name);

  const iSymbol = indexOf("symbol");
  const iDate = indexOf("date");
  const iClose = indexOf("close");

  if (iSymbol < 0 || iClose < 0) {
    return symbols.map((symbol) => ({
      symbol,
      ok: false,
      error: "Stooq başlık satırı tanınmadı",
      rawSample: lines[0].slice(0, 300),
    }));
  }

  const bySymbol = new Map<string, string[]>();
  for (const line of lines.slice(1)) {
    const cells = line.split(",").map((c) => c.trim());
    const raw = cells[iSymbol];
    if (!raw) continue;
    // "AAPL.US" → "AAPL"
    bySymbol.set(raw.toUpperCase().replace(/\.US$/, ""), cells);
  }

  return symbols.map((symbol): FetchedQuote => {
    const cells = bySymbol.get(symbol.trim().toUpperCase());
    if (!cells) {
      return { symbol, ok: false, error: `Stooq bu sembolü döndürmedi: ${symbol}` };
    }

    const closeRaw = cells[iClose];

    /* Bilinmeyen sembolde Stooq "N/D" yazar. Bunu sayıya çevirmeye kalkmak
       sessizce sıfır üretebilirdi; açıkça hata dönülür. */
    if (!closeRaw || /^n\/?d$/i.test(closeRaw)) {
      return { symbol, ok: false, error: `Stooq fiyat vermedi: ${symbol}` };
    }

    const priceMicro = toPriceMicro(toNumber(closeRaw));
    if (priceMicro === null) {
      return {
        symbol,
        ok: false,
        error: `Stooq geçersiz fiyat: ${closeRaw}`,
        rawSample: cells.join(","),
      };
    }

    return {
      symbol,
      ok: true,
      priceMicro,
      // Stooq önceki kapanışı vermiyor; günlük değişim bu kaynaktan çıkmaz.
      previousCloseMicro: null,
      currency: "USD",
      asOf: iDate >= 0 ? toISODate(cells[iDate] ?? null) : null,
      name: null,
    };
  });
}
