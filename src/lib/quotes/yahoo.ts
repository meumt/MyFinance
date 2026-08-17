import { pickDate, pickNumber, rawSampleOf, toPriceMicro, type Json } from "./parse";
import { RATE_LIMIT_PREFIX, type FetchedQuote } from "./types";

/**
 * Yahoo Finance grafik uç noktası.
 *
 * `/v8/finance/chart/<sembol>` hem NASDAQ (AAPL) hem Borsa İstanbul
 * (THYAO.IS) sembollerini kapsar ve API anahtarı istemez. Veri 15 dakikaya
 * kadar gecikmeli olabilir; portföy takibi için yeterli.
 *
 * ── Hız sınırı ve oturum ──────────────────────────────────────────────
 *
 * Çıplak istekler bir süre çalışıp sonra 429 ile geri çevrilmeye başlıyor.
 * Yahoo aslında bir oturum bekliyor; üç adımlık el sıkışma bunu kuruyor:
 *
 *   1. `fc.yahoo.com`'a GET — 404 dönse bile `Set-Cookie` gönderir,
 *   2. O çerezle `/v1/test/getcrumb` — kısa bir jeton (crumb) döner,
 *   3. Chart isteğine çerez + `crumb` parametresi eklenir.
 *
 * Oturum süreç ömrü boyunca (en çok bir saat) saklanır: portföydeki her
 * sembol için yeniden el sıkışmak, sınıra takılmanın kendisi olurdu.
 *
 * El sıkışma kurulamazsa çıplak isteğe düşülür — birçok ağda o da çalışıyor.
 * Yine 429 gelirse hata `RATE_LIMIT_PREFIX` ile işaretlenir ve çağıran katman
 * o sembolü uzun süre yeniden denemez.
 */

const HOSTS = [
  "https://query1.finance.yahoo.com",
  "https://query2.finance.yahoo.com",
];

const COOKIE_URL = "https://fc.yahoo.com";
const CRUMB_PATH = "/v1/test/getcrumb";

/** Tarayıcı görünümlü başlıklar — çıplak istekler daha çabuk sınırlanıyor. */
const HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  Accept: "application/json,text/plain,*/*",
  "Accept-Language": "tr-TR,tr;q=0.9,en;q=0.8",
  Referer: "https://finance.yahoo.com/",
};

/* ──────────────────────────────── Oturum ─────────────────────────────── */

interface YahooSession {
  cookie: string;
  crumb: string;
  createdAt: number;
}

const SESSION_TTL_MS = 60 * 60 * 1000;

/**
 * El sıkışma başarısız olursa bir süre yeniden denenmez.
 *
 * Bu olmazsa her sembol kendi el sıkışmasını başlatır: 20 sembollük bir
 * portföyde 40 ekstra istek eder ve sınıra takılmayı önlemek için eklenen
 * mekanizma sınıra takılmanın sebebi olur.
 */
const HANDSHAKE_BACKOFF_MS = 5 * 60 * 1000;

/** Süreç ömrü boyunca paylaşılan oturum. */
let session: YahooSession | null = null;
/** Aynı anda gelen isteklerin hepsi el sıkışmasın diye tek uçuş. */
let handshake: Promise<YahooSession | null> | null = null;
/** Son başarısızlıktan sonra yeniden denenebilecek an. */
let handshakeBlockedUntil = 0;

async function ensureSession(force: boolean): Promise<YahooSession | null> {
  if (!force && session && Date.now() - session.createdAt < SESSION_TTL_MS) {
    return session;
  }
  if (force) session = null;

  // Yakın zamanda başarısız olduysa çıplak isteğe düşülür.
  if (Date.now() < handshakeBlockedUntil) return null;

  /* El sıkışma sürerken gelen diğer semboller aynı sözü bekler; yoksa
     portföydeki her sembol ayrı bir el sıkışma başlatır. */
  if (!handshake) {
    handshake = createSession().finally(() => {
      handshake = null;
    });
  }

  const created = await handshake;
  if (created) {
    session = created;
    handshakeBlockedUntil = 0;
  } else {
    handshakeBlockedUntil = Date.now() + HANDSHAKE_BACKOFF_MS;
  }
  return created;
}

async function createSession(): Promise<YahooSession | null> {
  try {
    /* 1) Çerez. Yanıt 404 olsa bile Set-Cookie gelir; `ok` kontrolü yapılmaz.
       Yönlendirme izlenmez, çünkü çerez ilk yanıtın başlığındadır. */
    const cookieRes = await fetch(COOKIE_URL, {
      headers: HEADERS,
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });

    const cookie = parseSetCookie(readSetCookieHeaders(cookieRes));
    if (!cookie) return null;

    /* 2) Jeton. */
    const crumbRes = await fetch(`${HOSTS[0]}${CRUMB_PATH}`, {
      headers: { ...HEADERS, Cookie: cookie },
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    if (!crumbRes.ok) return null;

    const crumb = (await crumbRes.text()).trim();
    if (!isValidCrumb(crumb)) return null;

    return { cookie, crumb, createdAt: Date.now() };
  } catch {
    // El sıkışma başarısızsa çıplak isteğe düşülür; bu ölümcül değil.
    return null;
  }
}

/** `Set-Cookie` başlıklarını okur. Node 22'de `getSetCookie()` mevcut. */
function readSetCookieHeaders(res: Response): string[] {
  const headers = res.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof headers.getSetCookie === "function") return headers.getSetCookie();
  const single = res.headers.get("set-cookie");
  return single ? [single] : [];
}

/**
 * `Set-Cookie` satırlarını `Cookie` başlığına çevirir: her satırın yalnızca
 * `ad=değer` kısmı alınır, `Path`/`Expires` gibi öznitelikler atılır.
 */
export function parseSetCookie(raw: string[]): string | null {
  const pairs = raw
    .map((line) => line.split(";")[0].trim())
    .filter((pair) => pair.includes("=") && !pair.startsWith("="));
  return pairs.length > 0 ? pairs.join("; ") : null;
}

/**
 * Jeton kısa bir alfanümerik dizedir (örn. `aaBBccDD123`).
 * Captcha/HTML sayfası dönerse buradan geçmemeli — yoksa her isteğe
 * anlamsız bir crumb eklenir ve hepsi reddedilir.
 */
export function isValidCrumb(value: string): boolean {
  if (value.length === 0 || value.length > 64) return false;
  if (/[<>\s]/.test(value)) return false;
  return true;
}

/* ─────────────────────────────── İstek ───────────────────────────────── */

export async function fetchYahooQuote(
  symbol: string,
  timeoutMs = 15_000,
): Promise<FetchedQuote> {
  /* İki deneme: önce eldeki oturumla, sınıra takılırsa yeni oturum + ikinci
     sunucu. Sınırlama çoğu zaman tek sunucuya ya da bayat jetona özgü. */
  const attempts = [
    { host: HOSTS[0], refreshSession: false },
    { host: HOSTS[1], refreshSession: true },
  ];

  let lastError = `Yahoo yanıt vermedi: ${symbol}`;

  for (let i = 0; i < attempts.length; i++) {
    const { host, refreshSession } = attempts[i];
    if (i > 0) await sleep(700);

    const active = await ensureSession(refreshSession);

    const params = new URLSearchParams({ interval: "1d", range: "5d" });
    if (active) params.set("crumb", active.crumb);
    const url = `${host}/v8/finance/chart/${encodeURIComponent(symbol)}?${params}`;

    let res: Response;
    try {
      res = await fetch(url, {
        headers: active ? { ...HEADERS, Cookie: active.cookie } : HEADERS,
        signal: AbortSignal.timeout(timeoutMs),
        cache: "no-store",
      });
    } catch (error) {
      lastError =
        error instanceof Error ? `Bağlantı: ${error.message}` : "Bağlantı hatası";
      continue;
    }

    /* 401/403: jeton bayatlamış olabilir — sonraki deneme yenisini kurar. */
    if (res.status === 401 || res.status === 403) {
      session = null;
      lastError = `Yahoo oturumu reddetti (${res.status})`;
      continue;
    }

    if (res.status === 429) {
      // Bayat oturum da sebep olabilir; sonraki denemede yenilensin.
      session = null;
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

    const text = await res.text();

    /* Captcha/engel sayfası HTML döner. JSON ayrıştırma hatasını "bozuk
       yanıt" diye geçmek yerine ne olduğu söylenir. */
    if (text.trimStart().startsWith("<")) {
      session = null;
      lastError = `${RATE_LIMIT_PREFIX}: Yahoo JSON yerine engel sayfası döndürdü.`;
      continue;
    }

    try {
      return parseYahooBody(JSON.parse(text) as Json, symbol);
    } catch {
      return { symbol, ok: false, error: "Yanıt JSON olarak okunamadı" };
    }
  }

  return { symbol, ok: false, error: lastError };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Testlerin oturumu sıfırlayabilmesi için. */
export function resetYahooSession(): void {
  session = null;
  handshake = null;
  handshakeBlockedUntil = 0;
}

/* ─────────────────────────────── Ayrıştırma ──────────────────────────── */

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
