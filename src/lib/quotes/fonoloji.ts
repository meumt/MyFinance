import { pickDate, pickNumber, rawSampleOf, toPriceMicro, type Json } from "./parse";
import { RATE_LIMIT_PREFIX, type FetchedQuote } from "./types";

/**
 * Fonoloji — TEFAS fonları için JSON API. Kimlik doğrulama `X-API-Key`
 * başlığıyla yapılır, ücretsiz katman ayda 15.000 istek verir.
 *
 * Gerçek yanıt biçimi (gövde `fund` altında toplanır):
 *
 *   { "fund": { "code": "IJC", "name": "…",
 *               "current_price": 16.851023, "current_date": "2026-08-17",
 *               "return_1d": -0.00080677, … } }
 *
 * Birim pay değeri altı ondalıklıdır; bu yüzden fiyatlar kuruşta değil
 * micro (1e6) ölçeğinde tutulur.
 *
 * Alan adları değişirse fiyat UYDURULMAZ: hata döner ve yanıtın ham örneği
 * saklanır. Ayarlardaki "bağlantıyı sına" düğmesi o örneği gösterir.
 */

const BASE = "https://fonoloji.com/v1/funds";

/**
 * Birim pay değeri. İlk sıradakiler Fonoloji'nin gerçek alanları; kalanlar
 * biçim değişirse tutunacak yedeklerdir.
 */
const PRICE_PATHS = [
  "fund.current_price",
  "current_price",
  "fund.price",
  "price",
  "nav",
  "unitPrice",
  "unit_price",
  "unitShareValue",
  "birimPayDegeri",
  "birim_pay_degeri",
  "lastPrice",
  "last_price",
  "close",
  "data.price",
  "data.nav",
  "data.unitPrice",
  "data.birimPayDegeri",
  "fund.price",
  "fund.nav",
  "latest.price",
  "latest.nav",
  "latest.value",
  "data.latest.price",
  "data.latest.nav",
  "nav.latest",
  "nav.value",
  "navHistory.price",
  "navHistory.nav",
  "navHistory.value",
  "data.navHistory.price",
  "data.navHistory.value",
  "prices.price",
  "prices.value",
];

const PREVIOUS_PATHS = [
  "fund.previous_price",
  "previous_price",
  "previousPrice",
  "previous_price",
  "previousNav",
  "prevNav",
  "data.previousPrice",
  "data.previousNav",
  "latest.previousPrice",
];

const DATE_PATHS = [
  "fund.current_date",
  "current_date",
  "date",
  "asOf",
  "navDate",
  "tarih",
  "data.date",
  "data.navDate",
  "latest.date",
  "data.latest.date",
  "navHistory.date",
  "data.navHistory.date",
];

const NAME_PATHS = [
  "fund.name",
  "name",
  "title",
  "fundName",
  "data.title",
  "data.name",
  "fund.title",
];

/** Günlük getiri oranı — önceki kapanış bundan türetilir. */
const RETURN_1D_PATHS = ["fund.return_1d", "return_1d", "data.return_1d"];

export async function fetchFonolojiQuote(
  code: string,
  apiKey: string,
  timeoutMs = 15_000,
): Promise<FetchedQuote> {
  if (!apiKey) {
    return { symbol: code, ok: false, error: "Fonoloji API anahtarı girilmemiş" };
  }

  const raw = await requestFonoloji(code, apiKey, timeoutMs);
  if ("error" in raw) return { symbol: code, ok: false, error: raw.error };

  return parseFonolojiBody(raw.body, code);
}

/**
 * Yanıt gövdesini okur. Ağdan ayrıldı ki gerçek bir yanıt eline geçtiğinde
 * tek bir testle doğrulanabilsin.
 */
export function parseFonolojiBody(body: Json, code: string): FetchedQuote {
  const price = pickNumber(body, PRICE_PATHS);

  /* Sıfır/negatif fiyat geçerli değildir; buradan geçirilirse `ok: true` ile
     fiyatsız bir sonuç doğar ve portföy sessizce sıfırlanır. */
  const priceMicro = toPriceMicro(price);
  if (priceMicro === null) {
    return {
      symbol: code,
      ok: false,
      error:
        price === null
          ? "Fiyat alanı tanınmadı. Ayarlar → Fonoloji bağlantısını sına ile gelen yanıtı görebilirsiniz."
          : `Geçersiz fiyat: ${price}`,
      rawSample: rawSampleOf(body),
    };
  }

  return {
    symbol: code,
    ok: true,
    priceMicro,
    previousCloseMicro: previousCloseOf(body, price!),
    // TEFAS fonları TL cinsindendir.
    currency: "TRY",
    asOf: pickDate(body, DATE_PATHS),
    name: pickString(body, NAME_PATHS),
  };
}

/**
 * Önceki kapanış. Fonoloji doğrudan vermiyor; günlük getiri oranından
 * türetilir:  önceki = güncel / (1 + getiri).
 *
 * Oran sıfırsa değişim yok demektir ve null dönülür — arayüzün "%0" yerine
 * "bilinmiyor" demesi, uydurma bir kesinlik göstermesinden iyidir.
 */
function previousCloseOf(body: Json, price: number): number | null {
  const explicit = pickNumber(body, PREVIOUS_PATHS);
  if (explicit !== null && explicit !== price) return toPriceMicro(explicit);

  const return1d = pickNumber(body, RETURN_1D_PATHS);
  if (return1d === null || return1d === 0) return null;
  // -1 ve altındaki oran matematiksel olarak anlamsız (fon sıfırlanmış olurdu).
  if (return1d <= -1) return null;

  return toPriceMicro(price / (1 + return1d));
}

/**
 * Ham yanıtı döndürür — teşhis için. Ayarlar ekranındaki sınama düğmesi
 * bunu kullanır: alan adları değiştiğinde tahmin etmek yerine görürüz.
 */
export async function probeFonoloji(
  code: string,
  apiKey: string,
): Promise<{ ok: boolean; detail: string }> {
  const raw = await requestFonoloji(code, apiKey, 15_000);
  if ("error" in raw) return { ok: false, detail: raw.error };

  const price = pickNumber(raw.body, PRICE_PATHS);
  const pretty = rawSampleOf(raw.body, 1200);

  return price === null
    ? { ok: false, detail: `Fiyat alanı tanınmadı. Gelen yanıt: ${pretty}` }
    : { ok: true, detail: `Fiyat okundu: ${price}. Yanıt: ${pretty}` };
}

async function requestFonoloji(
  code: string,
  apiKey: string,
  timeoutMs: number,
): Promise<{ body: Json } | { error: string }> {
  const url = `${BASE}/${encodeURIComponent(code.trim().toUpperCase())}`;

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "X-API-Key": apiKey, Accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
  } catch (error) {
    return {
      error: error instanceof Error ? `Bağlantı: ${error.message}` : "Bağlantı hatası",
    };
  }

  if (res.status === 401 || res.status === 403) {
    return { error: "API anahtarı geçersiz ya da yetkisiz (HTTP " + res.status + ")" };
  }
  if (res.status === 404) {
    return { error: `Fon kodu bulunamadı: ${code}` };
  }
  if (res.status === 429) {
    return {
      error: `${RATE_LIMIT_PREFIX}: Fonoloji istek sınırı aşıldı (429). Fiyat bir süre sonra kendiliğinden yenilenecek.`,
    };
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { error: `Fonoloji HTTP ${res.status} ${text.slice(0, 120)}` };
  }

  try {
    return { body: (await res.json()) as Json };
  } catch {
    return { error: "Yanıt JSON değil" };
  }
}

function pickString(root: Json, paths: string[]): string | null {
  for (const path of paths) {
    let current: Json = root;
    for (const part of path.split(".")) {
      if (Array.isArray(current)) current = current[0];
      if (typeof current !== "object" || current === null) {
        current = undefined;
        break;
      }
      current = (current as Record<string, Json>)[part];
    }
    if (typeof current === "string" && current.trim().length > 0) return current.trim();
  }
  return null;
}
