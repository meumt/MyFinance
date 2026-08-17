/**
 * Fiyat ayrıştırma testleri — `npm run test:quotes`.
 *
 * Sağlayıcı yanıtları ağdan bağımsız olarak sınanır. Buradaki asıl amaç
 * ayrıştırmanın SESSİZCE yanlış bir sayı üretmediğini garanti etmek: fiyatı
 * okuyamadığında hata dönmeli, sıfır ya da tahmin dönmemeli.
 */
import { parseFonolojiBody } from "../src/lib/quotes/fonoloji";
import { toISODate, toNumber } from "../src/lib/quotes/parse";
import {
  isValidCrumb,
  parseSetCookie,
  parseYahooBody,
} from "../src/lib/quotes/yahoo";

let failed = 0;
let passed = 0;

function eq(actual: unknown, expected: unknown, msg: string) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) passed++;
  else {
    failed++;
    console.log(
      `FAIL  ${msg}\n      beklenen: ${JSON.stringify(expected)}\n      gelen   : ${JSON.stringify(actual)}`,
    );
  }
}

function group(name: string) {
  console.log(`\n── ${name}`);
}

/* ────────────────────────── Sayı ayrıştırma ────────────────────────── */
group("Sayı ayrıştırma (TR ve EN ondalık)");

eq(toNumber(41.25), 41.25, "sayı olduğu gibi");
eq(toNumber("41.25"), 41.25, "İngiliz ondalığı");
eq(toNumber("41,25"), 41.25, "Türkçe ondalık");
eq(toNumber("1.234,56"), 1234.56, "TR binlik + ondalık");
eq(toNumber("1,234.56"), 1234.56, "EN binlik + ondalık");
eq(toNumber("0,045678"), 0.045678, "fon birim pay değeri");
eq(toNumber("₺ 1.234,56"), 1234.56, "para simgesi atılır");
eq(toNumber(""), null, "boş metin sayı değil");
eq(toNumber("abc"), null, "harf sayı değil");
eq(toNumber(null), null, "null sayı değil");
eq(toNumber(Number.NaN), null, "NaN sayı değil");

group("Tarih ayrıştırma");

eq(toISODate("2026-08-17"), "2026-08-17", "ISO tarih");
eq(toISODate("2026-08-17T13:45:00Z"), "2026-08-17", "ISO zaman damgası kırpılır");
eq(toISODate("17.08.2026"), "2026-08-17", "Türkçe tarih");
eq(toISODate(1_786_974_300), "2026-08-17", "saniye epoch");
eq(toISODate("saçmalık"), null, "geçersiz tarih null");

/* ──────────────────────────── Yahoo yanıtı ──────────────────────────── */
group("Yahoo — NASDAQ hissesi");

/* Gerçek /v8/finance/chart yanıtının ilgili kısmı. */
const yahooBody = {
  chart: {
    result: [
      {
        meta: {
          currency: "USD",
          symbol: "AAPL",
          exchangeName: "NMS",
          fullExchangeName: "NasdaqGS",
          instrumentType: "EQUITY",
          regularMarketTime: 1_786_974_300,
          regularMarketPrice: 232.87,
          chartPreviousClose: 230.54,
          previousClose: 230.54,
          longName: "Apple Inc.",
          shortName: "Apple Inc.",
        },
        timestamp: [1_786_974_300],
        indicators: { quote: [{ close: [232.87] }] },
      },
    ],
    error: null,
  },
};

const apple = parseYahooBody(yahooBody, "AAPL");
eq(apple.ok, true, "yanıt okunur");
if (apple.ok) {
  eq(apple.priceMicro, 232_870_000, "fiyat micro'ya çevrilir");
  eq(apple.previousCloseMicro, 230_540_000, "önceki kapanış");
  eq(apple.currency, "USD", "para birimi USD");
  eq(apple.asOf, "2026-08-17", "tarih epoch'tan çözülür");
  eq(apple.name, "Apple Inc.", "isim okunur");
}

group("Yahoo — Borsa İstanbul hissesi");

const bistBody = {
  chart: {
    result: [
      {
        meta: {
          currency: "TRY",
          symbol: "THYAO.IS",
          fullExchangeName: "IST",
          regularMarketPrice: 312.75,
          chartPreviousClose: 308.5,
          longName: "Türk Hava Yolları A.O.",
        },
      },
    ],
    error: null,
  },
};

const thyao = parseYahooBody(bistBody, "THYAO.IS");
eq(thyao.ok, true, "BIST yanıtı okunur");
if (thyao.ok) {
  eq(thyao.priceMicro, 312_750_000, "BIST fiyatı");
  eq(thyao.currency, "TRY", "BIST para birimi TL");
}

group("Yahoo — seans kapalı, anlık fiyat yok");

/* Seans dışında `regularMarketPrice` gelmeyebilir; son kapanışa düşülür. */
const closedBody = {
  chart: {
    result: [{ meta: { currency: "TRY", previousClose: 100.5 } }],
    error: null,
  },
};
const closed = parseYahooBody(closedBody, "XU100.IS");
eq(closed.ok, true, "kapanış fiyatına düşülür");
if (closed.ok) {
  eq(closed.priceMicro, 100_500_000, "kapanış fiyatı kullanılır");
  eq(
    closed.previousCloseMicro,
    null,
    "fiyat ile önceki kapanış aynıysa değişim hesaplanmaz",
  );
}

group("Yahoo — hatalar sessizce yutulmaz");

const notFound = parseYahooBody(
  { chart: { result: null, error: { code: "Not Found", description: "No data found, symbol may be delisted" } } },
  "YOKBOYLE",
);
eq(notFound.ok, false, "gövdedeki hata yakalanır");
if (!notFound.ok) {
  eq(notFound.error, "No data found, symbol may be delisted", "hata metni aktarılır");
}

const garbage = parseYahooBody({ tamamen: "beklenmedik" }, "AAPL");
eq(garbage.ok, false, "tanınmayan gövde hata verir");
if (!garbage.ok) {
  eq(typeof garbage.rawSample, "string", "teşhis için ham örnek saklanır");
}

group("Yahoo — çerez/jeton el sıkışması");

/* fc.yahoo.com'un gerçekte gönderdiği biçim: birden çok Set-Cookie satırı,
   her biri öznitelikleriyle. Cookie başlığına yalnızca ad=değer girer. */
eq(
  parseSetCookie([
    "A1=d=AQABBHc; Expires=Tue, 17 Aug 2027 00:00:00 GMT; Max-Age=31557600; Domain=.yahoo.com; Path=/; HttpOnly; Secure; SameSite=Lax",
    "A3=d=AQABBXy; Path=/; Secure",
  ]),
  "A1=d=AQABBHc; A3=d=AQABBXy",
  "öznitelikler atılır, ad=değer çiftleri birleşir",
);
eq(parseSetCookie([]), null, "çerez yoksa null");
eq(parseSetCookie(["; Path=/"]), null, "ad=değer içermeyen satır atılır");
eq(
  parseSetCookie(["A1=abc; Path=/", "geçersiz", "B2=def"]),
  "A1=abc; B2=def",
  "bozuk satır diğerlerini bozmaz",
);

/* Jeton kısa ve alfanümeriktir; captcha/HTML sayfası buradan geçmemeli,
   yoksa her isteğe anlamsız bir crumb eklenir ve hepsi reddedilir. */
eq(isValidCrumb("aaBBccDD123"), true, "normal jeton");
eq(isValidCrumb("Ml9.J/8kQ2z"), true, "noktalama içeren jeton");
eq(isValidCrumb(""), false, "boş jeton geçersiz");
eq(isValidCrumb("<!DOCTYPE html><html>"), false, "HTML sayfası jeton değil");
eq(isValidCrumb("Too many requests"), false, "boşluklu metin jeton değil");
eq(isValidCrumb("x".repeat(65)), false, "aşırı uzun dize jeton değil");

/* ─────────────────────────── Fonoloji yanıtı ─────────────────────────── */
group("Fonoloji — alan adı varyantları");

/* Alan adları doğrulanamadığı için birkaç makul biçim de denenir.
   Hangisi gelirse gelsin fiyat aynı çıkmalı. */
const variants: Array<[string, unknown]> = [
  ["price", { code: "PHE", title: "Test Fonu", price: 0.045678, date: "2026-08-15" }],
  ["nav", { code: "PHE", nav: 0.045678, navDate: "2026-08-15" }],
  ["data.price", { data: { code: "PHE", price: 0.045678, date: "2026-08-15" } }],
  ["latest.nav", { code: "PHE", latest: { nav: 0.045678, date: "2026-08-15" } }],
  [
    "navHistory dizisi",
    { code: "PHE", navHistory: [{ value: 0.045678, date: "2026-08-15" }] },
  ],
  ["TR ondalıklı metin", { code: "PHE", price: "0,045678", date: "15.08.2026" }],
];

for (const [label, body] of variants) {
  const result = parseFonolojiBody(body, "PHE");
  eq(result.ok, true, `${label}: okunur`);
  if (result.ok) {
    eq(result.priceMicro, 45_678, `${label}: fiyat 0,045678`);
    eq(result.currency, "TRY", `${label}: TL`);
  }
}

group("Fonoloji — gerçek yanıt (IJC)");

/* Fonoloji'nin canlı yanıtından alınmış gerçek gövde. Alan adları buradan
   doğrulandı; biçim değişirse bu test önce kırılır. */
const ijcBody = {
  fund: {
    code: "IJC",
    name: "İŞ PORTFÖY YARI İLETKEN TEKNOLOJİLERİ DEĞİŞKEN FON",
    type: "YAT",
    category: "Değişken Şemsiye Fonu",
    management_company: "İş Portföy Yönetimi A.Ş.",
    first_seen: "2021-06-15",
    last_seen: "2026-08-17",
    updated_at: 1_786_978_813_683,
    isin: "TRYISPO00704",
    risk_score: 6,
    trading_status: "AKTİF",
    current_price: 16.851023,
    current_date: "2026-08-17",
    return_1d: -0.0008067773088870998,
    return_1w: 0.017283,
    return_1m: 0.052459,
    aum: 5_462_378_527.97,
    investor_count: 47_404,
  },
};

const ijc = parseFonolojiBody(ijcBody, "IJC");
eq(ijc.ok, true, "gerçek yanıt okunur");
if (ijc.ok) {
  eq(ijc.priceMicro, 16_851_023, "birim pay değeri 16,851023");
  eq(ijc.currency, "TRY", "TL");
  eq(ijc.asOf, "2026-08-17", "değerleme tarihi");
  eq(
    ijc.name,
    "İŞ PORTFÖY YARI İLETKEN TEKNOLOJİLERİ DEĞİŞKEN FON",
    "fon adı",
  );

  /* Önceki kapanış günlük getiriden türetilir:
     16,851023 / (1 − 0,0008067773) = 16,864628… */
  const expectedPrev = Math.round(
    (16.851023 / (1 - 0.0008067773088870998)) * 1_000_000,
  );
  eq(ijc.previousCloseMicro, expectedPrev, "önceki kapanış getiriden türetilir");

  /* Türetilen değişim oranı, Fonoloji'nin bildirdiği getiriye eşit olmalı. */
  const derived =
    (ijc.priceMicro - ijc.previousCloseMicro!) / ijc.previousCloseMicro!;
  eq(
    Math.abs(derived - -0.0008067773088870998) < 1e-9,
    true,
    "türetilen günlük değişim bildirilen getiriyle tutarlı",
  );
}

/* Getiri sıfırsa uydurma bir "%0 değişim" üretilmez. */
const flat = parseFonolojiBody(
  { fund: { current_price: 10, current_date: "2026-08-17", return_1d: 0 } },
  "TEST",
);
eq(flat.ok, true, "okunur");
if (flat.ok) {
  eq(flat.previousCloseMicro, null, "getiri sıfırsa önceki kapanış bilinmiyor");
}

group("Fonoloji — tanınmayan yanıt fiyat UYDURMAZ");

const unknown = parseFonolojiBody(
  { code: "PHE", bambaskaBirAlan: 0.045678 },
  "PHE",
);
eq(unknown.ok, false, "tanınmayan alan hata verir");
if (!unknown.ok) {
  eq(
    unknown.rawSample?.includes("bambaskaBirAlan"),
    true,
    "ham örnek gerçek alan adını gösterir",
  );
}

/* Sıfır ya da negatif fiyat geçerli değildir. */
const zero = parseFonolojiBody({ price: 0 }, "PHE");
eq(zero.ok, false, "sıfır fiyat kabul edilmez");

group("Fonoloji — önceki kapanış ve isim");

const withPrev = parseFonolojiBody(
  { title: "Test Fonu", price: 0.05, previousPrice: 0.048, date: "2026-08-15" },
  "PHE",
);
eq(withPrev.ok, true, "okunur");
if (withPrev.ok) {
  eq(withPrev.previousCloseMicro, 48_000, "önceki kapanış");
  eq(withPrev.name, "Test Fonu", "fon adı");
  eq(withPrev.asOf, "2026-08-15", "değerleme tarihi");
}

/* ────────────────────────────── Sonuç ────────────────────────────── */
console.log(
  failed === 0
    ? `\n✓ ${passed} testin tamamı geçti`
    : `\n✗ ${failed} test başarısız (${passed} geçti)`,
);
process.exit(failed === 0 ? 0 : 1);
