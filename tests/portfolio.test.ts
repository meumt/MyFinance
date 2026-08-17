/**
 * Portföy matematiği testleri — `npm run test:portfolio`.
 *
 * Buradaki senaryolar ondalık ve taşma tuzaklarını kilitler: fon birim pay
 * değeri kuruştan küçüktür, adet kesirlidir ve adet × fiyat çarpımı
 * Number'ın güvenli tam sayı aralığını kolayca aşar.
 */
import type { Holding, Quote } from "../src/db/schema";
import type { RateMap } from "../src/lib/convert";
import {
  applyPurchase,
  applySale,
  buildPortfolio,
  formatQuantity,
  providerSymbol,
  quoteKey,
  unitCostMicroOf,
  valueMinorOf,
} from "../src/lib/portfolio";

let failed = 0;
let passed = 0;

function eq(actual: unknown, expected: unknown, msg: string) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    passed++;
  } else {
    failed++;
    console.log(
      `FAIL  ${msg}\n      beklenen: ${JSON.stringify(expected)}\n      gelen   : ${JSON.stringify(actual)}`,
    );
  }
}

function near(actual: number, expected: number, tolerance: number, msg: string) {
  if (Math.abs(actual - expected) <= tolerance) passed++;
  else {
    failed++;
    console.log(`FAIL  ${msg}\n      beklenen ≈${expected}\n      gelen    ${actual}`);
  }
}

function group(name: string) {
  console.log(`\n── ${name}`);
}

/* ───────────────────────── Değer hesabı ve taşma ───────────────────────── */
group("Pozisyon değeri");

// 100 adet × 250,00 TL = 25.000,00 TL
eq(valueMinorOf(100 * 1_000_000, 250 * 1_000_000), 25_000_00, "tam sayı adet ve fiyat");

// Fon: 1.234,567890 pay × 0,045678 TL birim pay değeri
// = 56,392392 TL → 5639 kuruş
eq(valueMinorOf(1_234_567_890, 45_678), 5_639, "kesirli pay ve kuruşaltı birim fiyat");

/* Taşma tuzağı: q × p burada 1e17 mertebesinde, Number ile yapılsa
   MAX_SAFE_INTEGER (9,007e15) aşılır ve sonuç sessizce kayar. */
const bigQty = 1_000_000 * 1_000_000; // 1.000.000 adet
const bigPrice = 100 * 1_000_000; // 100,00 TL
eq(valueMinorOf(bigQty, bigPrice), 100_000_000_00, "1e17 çarpımda taşma yok");
eq(
  bigQty * bigPrice > Number.MAX_SAFE_INTEGER,
  true,
  "senaryo gerçekten güvenli aralığın dışında",
);

// Yuvarlama yarımı yukarı taşır.
eq(valueMinorOf(1_000_000, 1_005_000), 100 + 1, "1,005 TL → 101 kuruş (yarım yukarı)");
eq(valueMinorOf(0, 45_678), 0, "adet sıfırsa değer sıfır");

/* ─────────────────────────── Ortalama maliyet ─────────────────────────── */
group("Ortalama birim maliyet");

// 10.000,00 TL ödenip 250 adet alındıysa birim maliyet 40,00 TL
eq(unitCostMicroOf(10_000_00, 250 * 1_000_000), 40 * 1_000_000, "birim maliyet");
eq(unitCostMicroOf(10_000_00, 0), null, "adet yoksa birim maliyet tanımsız");

// Fon: 5.000,00 TL ile 0,045678 TL'den alınan pay adedi ~109.462,32
// Ters yönde tutarlılık: maliyet × adet ≈ ödenen tutar
const fonQty = 109_462_320_000; // 109.462,32 pay
const fonUnit = unitCostMicroOf(5_000_00, fonQty)!;
/* Birim fiyat 6 basamakta kesildiği için geri dönüşte kuruş mertebesinde
   sapma kaçınılmazdır — 109 bin payda 2 kuruş. Toplamlar her zaman saklanan
   `totalCostMinor` üzerinden okunur, birim maliyetten geri çarpılarak değil;
   bu test o sapmanın mertebesini kilitler. */
near(valueMinorOf(fonQty, fonUnit), 5_000_00, 5, "birim maliyet mertebe olarak tutarlı");

/* ────────────────────────── Sembol eşlemesi ────────────────────────── */
group("Sağlayıcı sembolü");

eq(providerSymbol("bist", "thyao"), "THYAO.IS", "BIST sembolüne .IS eklenir");
eq(providerSymbol("bist", "THYAO.IS"), "THYAO.IS", "zaten ekliyse iki kez eklenmez");
eq(providerSymbol("nasdaq", "aapl"), "AAPL", "NASDAQ sembolü olduğu gibi");
eq(providerSymbol("tefas", "phe"), "PHE", "fon kodu büyük harfe çevrilir");
eq(
  quoteKey("yahoo", "bist", "THYAO"),
  quoteKey("yahoo", "bist", "thyao.is"),
  "aynı sembol tek önbellek anahtarı üretir",
);

/* ──────────────────────────── Adet gösterimi ──────────────────────────── */
group("Adet gösterimi");

eq(formatQuantity(100 * 1_000_000), "100", "tam adet ondalık göstermez");
eq(formatQuantity(1_500_000), "1,5", "kesirli adet");

/* ──────────────────────────── Portföy toplamı ──────────────────────────── */
group("Portföy toplamı ve kâr/zarar");

let holdingId = 0;
function holding(overrides: Partial<Holding> = {}): Holding {
  return {
    id: ++holdingId,
    kind: "hisse",
    market: "bist",
    symbol: "THYAO",
    name: "Türk Hava Yolları",
    currency: "TRY",
    quantityMicro: 100 * 1_000_000,
    totalCostMinor: 20_000_00,
    totalCostTryMinor: null,
    provider: "yahoo",
    manualPriceMicro: null,
    brokerAccountId: null,
    isActive: true,
    excludeFromNetWorth: false,
    color: "#8b5cf6",
    sortOrder: 0,
    notes: null,
    createdAt: Date.parse("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function quote(overrides: Partial<Quote> & { symbol: string }): Quote {
  return {
    id: 1,
    provider: "yahoo",
    priceMicro: null,
    currency: "TRY",
    previousCloseMicro: null,
    asOf: "2026-08-17",
    fetchedAt: Date.parse("2026-08-17T12:00:00Z"),
    error: null,
    rawSample: null,
    ...overrides,
  };
}

const rates: RateMap = new Map([["USD", 41_000_000]]); // 1 USD = 41,00 TL

/* BIST: 100 adet, 20.000 maliyet, fiyat 250 → değer 25.000, kâr 5.000 (%25) */
const bist = holding({ symbol: "THYAO", quantityMicro: 100_000_000, totalCostMinor: 20_000_00 });
/* NASDAQ: 10 adet AAPL, 2.000 USD maliyet, ödenen TL 70.000, fiyat 250 USD
   → değer 2.500 USD = 102.500 TL, kâr 32.500 TL */
const nasdaq = holding({
  symbol: "AAPL",
  name: "Apple",
  market: "nasdaq",
  currency: "USD",
  quantityMicro: 10_000_000,
  totalCostMinor: 2_000_00,
  totalCostTryMinor: 70_000_00,
});
/* Fiyatı bilinmeyen fon — toplamı bozmamalı */
const bilinmeyen = holding({
  symbol: "PHE",
  name: "Bilinmeyen Fon",
  market: "tefas",
  kind: "fon",
  provider: "fonoloji",
  quantityMicro: 1_000_000_000,
  totalCostMinor: 5_000_00,
});

const quotes = new Map<string, Quote>([
  [
    quoteKey("yahoo", "bist", "THYAO"),
    quote({ symbol: "THYAO.IS", priceMicro: 250_000_000, previousCloseMicro: 240_000_000 }),
  ],
  [
    quoteKey("yahoo", "nasdaq", "AAPL"),
    quote({ symbol: "AAPL", currency: "USD", priceMicro: 250_000_000 }),
  ],
]);

const p = buildPortfolio({ holdings: [bist, nasdaq, bilinmeyen], quotes, rates });

eq(p.valueTryMinor, 25_000_00 + 102_500_00, "toplam değer TL");
eq(p.costTryMinor, 20_000_00 + 70_000_00, "fiyatı bilinmeyen kalemin maliyeti toplama girmez");
eq(p.gainTryMinor, 5_000_00 + 32_500_00, "toplam kâr");
eq(p.missingPriceCount, 1, "fiyatı bilinmeyen kalem sayılır");

const bistView = p.items.find((i) => i.holding.symbol === "THYAO")!;
eq(bistView.valueTryMinor, 25_000_00, "BIST değeri");
near(bistView.gainRatio!, 0.25, 0.0001, "BIST kâr oranı %25");
// 240 → 250: %4,1666 günlük artış, tutarda 25.000 − 24.000 = 1.000
near(bistView.dayChangeRatio!, 10 / 240, 0.0001, "günlük değişim oranı");
eq(bistView.dayChangeTryMinor, 1_000_00, "günlük değişim tutarı");

const nasdaqView = p.items.find((i) => i.holding.symbol === "AAPL")!;
eq(nasdaqView.valueMinor, 2_500_00, "NASDAQ değeri USD olarak");
eq(nasdaqView.valueTryMinor, 102_500_00, "NASDAQ değeri TL'ye çevrilir");
eq(nasdaqView.costTryIsEstimate, false, "ödenen TL girilmişse tahmin değil");

const unknownView = p.items.find((i) => i.holding.symbol === "PHE")!;
eq(unknownView.valueTryMinor, null, "fiyatı yoksa değer null, sıfır değil");
eq(unknownView.gainRatio, null, "fiyatı yoksa kâr oranı yok");

/* Ağırlıklar toplamı 1 olmalı (fiyatı bilinenler arasında). */
near(
  p.items.reduce((s, i) => s + i.weight, 0),
  1,
  0.0001,
  "ağırlıklar toplamı 1",
);

/* ─────────────────── Kuru bilinmeyen döviz sessizce sıfırlanmaz ────────── */
group("Kuru bilinmeyen para birimi");

const noRates = buildPortfolio({ holdings: [nasdaq], quotes, rates: new Map() });
eq(noRates.valueTryMinor, 0, "çevrilemeyen değer toplama katılmaz");
eq(noRates.missingRates, ["USD"], "eksik kur bildirilir");
eq(noRates.items[0].valueMinor, 2_500_00, "kendi biriminde değer yine hesaplanır");

/* ─────────────────── Elle girilen fiyat sağlayıcıyı ezer ─────────────── */
group("Elle girilen fiyat");

const elle = holding({
  symbol: "THYAO",
  quantityMicro: 100_000_000,
  totalCostMinor: 20_000_00,
  manualPriceMicro: 300_000_000,
});
const ellePortfolio = buildPortfolio({ holdings: [elle], quotes, rates });
eq(ellePortfolio.valueTryMinor, 30_000_00, "elle girilen fiyat kullanılır");
eq(ellePortfolio.items[0].isManualPrice, true, "elle girildiği işaretlenir");

/* ───────────────────────────── Alım ve satım ───────────────────────────── */
group("Alım eklenince ortalama maliyet");

/* 100 adet 20.000 TL'ye alınmış (birim 200). 50 adet daha 250'den alınıyor
   → 150 adet, 32.500 TL, birim 216,67 */
const after = applyPurchase(
  { quantityMicro: 100_000_000, totalCostMinor: 20_000_00, totalCostTryMinor: 20_000_00 },
  { quantityMicro: 50_000_000, costMinor: 12_500_00, costTryMinor: 12_500_00 },
);
eq(after.quantityMicro, 150_000_000, "adet toplanır");
eq(after.totalCostMinor, 32_500_00, "maliyet toplanır");
near(unitCostMicroOf(after.totalCostMinor, after.quantityMicro)!, 216_666_667, 2, "ağırlıklı ortalama birim maliyet");

/* TL maliyeti bir tarafta eksikse toplam tahmine düşmez, bilinmiyor olur. */
const partial = applyPurchase(
  { quantityMicro: 100_000_000, totalCostMinor: 2_000_00, totalCostTryMinor: 70_000_00 },
  { quantityMicro: 10_000_000, costMinor: 250_00, costTryMinor: null },
);
eq(partial.totalCostTryMinor, null, "eksik TL maliyeti toplamı bilinmez yapar");

group("Satışta maliyet oransal düşer");

/* 150 adet / 32.500 TL. 50 adet 15.000'e satılıyor:
   düşen maliyet 32.500 × 50/150 = 10.833,33 → gerçekleşen kâr 4.166,67 */
const sold = applySale(
  { quantityMicro: 150_000_000, totalCostMinor: 32_500_00, totalCostTryMinor: 32_500_00 },
  { quantityMicro: 50_000_000, proceedsMinor: 15_000_00 },
);
eq(sold.quantityMicro, 100_000_000, "kalan adet");
near(sold.totalCostMinor, 21_666_67, 1, "kalan maliyet");
near(sold.realizedMinor, 4_166_67, 1, "gerçekleşen kâr");

/* Tamamı satılırsa maliyet sıfırlanır — kuruş artığı kalmamalı. */
const allSold = applySale(
  { quantityMicro: 150_000_000, totalCostMinor: 32_500_00, totalCostTryMinor: 32_500_00 },
  { quantityMicro: 150_000_000, proceedsMinor: 40_000_00 },
);
eq(allSold.quantityMicro, 0, "adet sıfırlanır");
eq(allSold.totalCostMinor, 0, "maliyet tam sıfırlanır");
eq(allSold.realizedMinor, 7_500_00, "gerçekleşen kâr");

/* Elde olandan fazlası satılamaz. */
const overSold = applySale(
  { quantityMicro: 10_000_000, totalCostMinor: 1_000_00, totalCostTryMinor: null },
  { quantityMicro: 999_000_000, proceedsMinor: 2_000_00 },
);
eq(overSold.quantityMicro, 0, "fazla satış elde olanla sınırlanır");

/* ────────────────────────────── Sonuç ────────────────────────────── */
console.log(
  failed === 0
    ? `\n✓ ${passed} testin tamamı geçti`
    : `\n✗ ${failed} test başarısız (${passed} geçti)`,
);
process.exit(failed === 0 ? 0 : 1);
