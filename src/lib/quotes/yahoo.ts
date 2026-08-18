import { pickDate, pickNumber, rawSampleOf, toPriceMicro, type Json } from "./parse";
import {
  RATE_LIMIT_PREFIX,
  type ExtendedSessionQuote,
  type FetchedQuote,
} from "./types";

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

/**
 * İki el sıkışma arasındaki en kısa süre — BAŞARILI olsa bile.
 *
 * 429 alan her sembol oturumu bayat sayıp yenisini istiyordu. Yirmi sembollük
 * bir portföyde Yahoo sınırlamaya başladığında bu, yirmi el sıkışma (kırk
 * ekstra istek) demekti: sınırı aşmamak için eklenen mekanizma sınırı
 * besliyordu. Bu aralık, sınırlama sürerken el sıkışmanın da seyrelmesini
 * sağlar.
 */
const HANDSHAKE_MIN_INTERVAL_MS = 60 * 1000;

/** Süreç ömrü boyunca paylaşılan oturum. */
let session: YahooSession | null = null;
/** Aynı anda gelen isteklerin hepsi el sıkışmasın diye tek uçuş. */
let handshake: Promise<YahooSession | null> | null = null;
/** Son başarısızlıktan sonra yeniden denenebilecek an. */
let handshakeBlockedUntil = 0;
/** Son el sıkışma denemesinin anı — sonucu ne olursa olsun. */
let lastHandshakeAt = 0;

async function ensureSession(force: boolean): Promise<YahooSession | null> {
  if (!force && session && Date.now() - session.createdAt < SESSION_TTL_MS) {
    return session;
  }

  // Yakın zamanda başarısız olduysa çıplak isteğe düşülür.
  if (Date.now() < handshakeBlockedUntil) return null;

  /* Zorlama gelse bile aralıktan önce yeniden el sıkışılmaz. Elde bir oturum
     varsa o kullanılır; yoksa çıplak isteğe düşülür. */
  if (
    handshake === null &&
    Date.now() - lastHandshakeAt < HANDSHAKE_MIN_INTERVAL_MS
  ) {
    return session;
  }

  if (force) session = null;

  /* El sıkışma sürerken gelen diğer semboller aynı sözü bekler; yoksa
     portföydeki her sembol ayrı bir el sıkışma başlatır. */
  if (!handshake) {
    lastHandshakeAt = Date.now();
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
    /* 1) Çerez. */
    const cookie = await collectCookie();
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

/**
 * Çerezi toplar.
 *
 * `fc.yahoo.com` çoğu zaman 404 döner ve çerezi o yanıtta gönderir; ama bazı
 * ağlarda önce bir onay/yönlendirme sayfasına atar ve çerezin bir kısmı ancak
 * SONRAKİ adımda gelir. Referans uygulama çerez kavanozu (cookie jar) kullanıp
 * bütün adımlardaki çerezleri biriktirdiği için bu fark görünmüyor; Node'un
 * `fetch`'inde kavanoz yok, o yüzden yönlendirme zinciri elle yürünür ve her
 * adımın çerezi toplanır. Yalnızca ilk yanıta bakmak, o ağlarda eksik çerez
 * üretir ve jeton isteği reddedilir.
 */
async function collectCookie(maxHops = 5): Promise<string | null> {
  const collected: string[] = [];
  let url = COOKIE_URL;

  for (let hop = 0; hop < maxHops; hop++) {
    const carried = parseSetCookie(collected);
    const res = await fetch(url, {
      headers: carried ? { ...HEADERS, Cookie: carried } : HEADERS,
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });

    collected.push(...readSetCookieHeaders(res));

    const location = res.headers.get("location");
    const isRedirect = res.status >= 300 && res.status < 400 && location;
    if (!isRedirect) break;

    // Göreli konum mutlak adrese çevrilir.
    url = new URL(location, url).toString();
  }

  return parseSetCookie(collected);
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
 *
 * Aynı çerez birden çok adımda gelirse SONUNCUSU geçerlidir — tarayıcı da,
 * referans uygulamadaki çerez kavanozu da böyle davranır. Aynı adı iki kez
 * göndermek sunucuyu şaşırtır.
 */
export function parseSetCookie(raw: string[]): string | null {
  const byName = new Map<string, string>();

  for (const line of raw) {
    const pair = line.split(";")[0].trim();
    const separator = pair.indexOf("=");
    if (separator <= 0) continue;
    byName.set(pair.slice(0, separator), pair.slice(separator + 1));
  }

  if (byName.size === 0) return null;
  return [...byName].map(([name, value]) => `${name}=${value}`).join("; ");
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
  lastHandshakeAt = 0;
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
    extended: readYahooExtended(meta, price),
  };
}

/**
 * Yahoo'nun seans dışı fiyatı.
 *
 * `chart` uç noktasının `meta` alanı seans dışı fiyatı doğrudan vermez ama
 * `postMarketPrice` / `preMarketPrice` alanları geldiğinde okunur. Değişim
 * oranı normal seans kapanışına göre hesaplanır — TradingView'in tanımıyla
 * aynı taban, böylece iki kaynak arasında sayı değişmez.
 */
function readYahooExtended(
  meta: Json,
  regularPrice: number | null,
): ExtendedSessionQuote | null {
  const candidates: Array<{ session: "sonrasi" | "oncesi"; field: string }> = [
    { session: "sonrasi", field: "postMarketPrice" },
    { session: "oncesi", field: "preMarketPrice" },
  ];

  for (const candidate of candidates) {
    const value = pickNumber(meta, [candidate.field]);
    const priceMicro = toPriceMicro(value);
    if (priceMicro === null) continue;

    const changeBps =
      regularPrice !== null && regularPrice > 0 && value !== null
        ? Math.round(((value - regularPrice) / regularPrice) * 10_000)
        : null;

    return { priceMicro, changeBps, session: candidate.session };
  }

  return null;
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
