import type { Holding, Quote } from "@/db/schema";
import { convert, type RateMap } from "./convert";
import type { ISODate } from "./dates";

/**
 * Portföy matematiği. Saf fonksiyonlardır: veritabanına ve ağa dokunmaz.
 *
 * Ondalık hiçbir yerde float'a bırakılmaz:
 *  - adet   : `quantityMicro` = adet × 1e6 (fon pay adedi kesirli olabilir)
 *  - fiyat  : `priceMicro`    = birim fiyat × 1e6 (fon birim pay değeri
 *             0,045678 gibi olabilir; kuruş hassasiyeti yetmez)
 *  - tutar  : minor           = para biriminin kuruşu
 */

export const QTY_SCALE = 1_000_000;
export const PRICE_SCALE = 1_000_000;

/**
 * Pozisyon değeri, kote para biriminin kuruşu olarak.
 *
 * değer = (adet) × (fiyat) = (q/1e6) × (p/1e6) → kuruş için ×100
 *       = q × p / 1e10
 *
 * Çarpım 1e15'i aşabildiği için BigInt kullanılır: 1000 adet × 100 TL
 * hesabında bile ara sonuç 1e17'dir ve Number ile sessizce bozulur.
 */
export function valueMinorOf(quantityMicro: number, priceMicro: number): number {
  const divisor = 10_000_000_000n; // 1e10
  const product = BigInt(Math.round(quantityMicro)) * BigInt(Math.round(priceMicro));
  return Number(roundedDiv(product, divisor));
}

/** Tam sayı bölme, yarımı sıfırdan uzağa yuvarlar. */
function roundedDiv(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0n;
  const abs = negative ? -numerator : numerator;
  const result = (abs * 2n + denominator) / (denominator * 2n);
  return negative ? -result : result;
}

/**
 * Ortalama birim maliyet (× 1e6), kote para biriminde.
 * Toplam maliyet / adet — adet sıfırsa tanımsızdır.
 */
export function unitCostMicroOf(
  totalCostMinor: number,
  quantityMicro: number,
): number | null {
  if (quantityMicro <= 0) return null;
  /* birim maliyet (para birimi) = (totalCostMinor/100) / (quantityMicro/1e6)
     ×1e6 ile micro'ya:            = totalCostMinor × 1e10 / quantityMicro */
  const numerator = BigInt(Math.round(totalCostMinor)) * 10_000_000_000n;
  return Number(roundedDiv(numerator, BigInt(Math.round(quantityMicro))));
}

/** Adet gösterimi: gereksiz sıfırlar atılır, en çok 6 basamak. */
export function formatQuantity(quantityMicro: number): string {
  const units = quantityMicro / QTY_SCALE;
  const digits = Number.isInteger(units) ? 0 : units < 1 ? 6 : 4;
  return units.toLocaleString("tr-TR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });
}

/**
 * Birim fiyat gösterimi.
 *
 * En çok 6 basamak gösterilir, sondaki gereksiz sıfırlar atılır: fonun birim
 * pay değeri 16,851023 iken 16,85 yazmak fonda anlamlı olan basamakları
 * siler; hissede 312,75 zaten iki basamaktır ve öyle kalır.
 */
export function formatUnitPrice(priceMicro: number, currency = "TRY"): string {
  return new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  }).format(priceMicro / PRICE_SCALE);
}

/* ─────────────────────────── Pazar tanımları ─────────────────────────── */

export type Market = "tefas" | "bist" | "nasdaq" | "diger";
export type Provider = "fonoloji" | "yahoo" | "manuel";

export const MARKET_LABEL: Record<Market, string> = {
  tefas: "TEFAS fonu",
  bist: "Borsa İstanbul",
  nasdaq: "NASDAQ / ABD",
  diger: "Diğer",
};

export const MARKET_CURRENCY: Record<Market, string> = {
  tefas: "TRY",
  bist: "TRY",
  nasdaq: "USD",
  diger: "TRY",
};

/** Pazarın varsayılan fiyat kaynağı. */
export const MARKET_PROVIDER: Record<Market, Provider> = {
  tefas: "fonoloji",
  bist: "yahoo",
  nasdaq: "yahoo",
  diger: "manuel",
};

export function isMarket(value: string): value is Market {
  return value === "tefas" || value === "bist" || value === "nasdaq" || value === "diger";
}

/**
 * Sağlayıcının beklediği sembol. Kullanıcı sade kodu yazar (THYAO);
 * Yahoo Borsa İstanbul için `.IS` ekini ister.
 */
export function providerSymbol(market: string, symbol: string): string {
  const clean = symbol.trim().toUpperCase();
  if (market === "bist") return clean.endsWith(".IS") ? clean : `${clean}.IS`;
  return clean;
}

/** Önbellek anahtarı: aynı sembolü iki hesapta tutmak tek istek eder. */
export function quoteKey(provider: string, market: string, symbol: string): string {
  return `${provider}:${providerSymbol(market, symbol)}`;
}

/* ──────────────────────────── Görünüm modeli ──────────────────────────── */

export interface HoldingView {
  holding: Holding;
  /** Birim fiyat (× 1e6), kote para biriminde. Bilinmiyorsa null. */
  priceMicro: number | null;
  /** Elle girilmiş fiyat mı kullanıldı. */
  isManualPrice: boolean;
  /** Kote para biriminde değer ve maliyet. */
  valueMinor: number | null;
  costMinor: number;
  /** TL karşılıkları. */
  valueTryMinor: number | null;
  costTryMinor: number;
  /** Maliyetin TL karşılığı bugünkü kurdan tahmin edildiyse true. */
  costTryIsEstimate: boolean;
  gainTryMinor: number | null;
  gainRatio: number | null;
  /** Günlük değişim — önceki kapanışa göre. */
  dayChangeRatio: number | null;
  dayChangeTryMinor: number | null;
  unitCostMicro: number | null;
  /** Portföydeki ağırlık (0-1). */
  weight: number;
  asOf: ISODate | null;
  fetchedAt: number | null;
  quoteError: string | null;
}

export interface PortfolioGroup {
  key: string;
  label: string;
  valueTryMinor: number;
  costTryMinor: number;
  gainTryMinor: number;
  ratio: number;
  count: number;
}

export interface Portfolio {
  items: HoldingView[];
  /** Fiyatı bilinen kalemlerin toplam TL değeri. */
  valueTryMinor: number;
  costTryMinor: number;
  gainTryMinor: number;
  gainRatio: number;
  dayChangeTryMinor: number;
  dayChangeRatio: number;
  byMarket: PortfolioGroup[];
  /** Fiyatı hiç bilinmeyen kalemler — toplam yanıltmasın diye ayrı sayılır. */
  missingPriceCount: number;
  /** Kuru bilinmediği için TL'ye çevrilemeyen para birimleri. */
  missingRates: string[];
  /** En eski fiyatın çekildiği an — "veriler ne kadar taze" göstergesi. */
  oldestFetchedAt: number | null;
  /** Sağlayıcı hatası olan kalem sayısı. */
  errorCount: number;
}

export interface PortfolioInput {
  holdings: Holding[];
  /** quoteKey() → Quote */
  quotes: Map<string, Quote>;
  rates: RateMap;
}

export function buildPortfolio(input: PortfolioInput): Portfolio {
  const { holdings, quotes, rates } = input;
  const missingRates = new Set<string>();

  const items: HoldingView[] = [];

  for (const holding of holdings) {
    if (!holding.isActive) continue;

    const quote = quotes.get(
      quoteKey(holding.provider, holding.market, holding.symbol),
    );

    /* Elle girilen fiyat sağlayıcıdan gelene tercih edilir: kullanıcı
       bilinçli olarak yazmıştır ve sağlayıcı o sembolü tanımıyor olabilir. */
    const isManual = holding.provider === "manuel" || holding.manualPriceMicro != null;
    const priceMicro = isManual
      ? (holding.manualPriceMicro ?? quote?.priceMicro ?? null)
      : (quote?.priceMicro ?? holding.manualPriceMicro ?? null);

    const quoteCurrency = quote?.currency ?? holding.currency;

    const valueMinor =
      priceMicro == null ? null : valueMinorOf(holding.quantityMicro, priceMicro);

    /* Değeri TL'ye çevir. Kur bilinmiyorsa sıfır saymak yerine null bırakılır;
       yanlış bir toplam, eksik bir toplamdan kötüdür. */
    let valueTryMinor: number | null = null;
    if (valueMinor != null) {
      const converted = convert(valueMinor, quoteCurrency, "TRY", rates);
      if (converted.amountMinor == null) {
        if (converted.missingCurrency) missingRates.add(converted.missingCurrency);
      } else {
        valueTryMinor = converted.amountMinor;
      }
    }

    /* Maliyet: ödenen TL varsa o kullanılır, yoksa bugünkü kurdan tahmin. */
    let costTryMinor = 0;
    let costTryIsEstimate = false;
    if (holding.totalCostTryMinor != null) {
      costTryMinor = holding.totalCostTryMinor;
    } else if (holding.currency === "TRY") {
      costTryMinor = holding.totalCostMinor;
    } else {
      const converted = convert(holding.totalCostMinor, holding.currency, "TRY", rates);
      if (converted.amountMinor == null) {
        if (converted.missingCurrency) missingRates.add(converted.missingCurrency);
      } else {
        costTryMinor = converted.amountMinor;
        costTryIsEstimate = true;
      }
    }

    const gainTryMinor =
      valueTryMinor == null ? null : valueTryMinor - costTryMinor;
    const gainRatio =
      valueTryMinor == null || costTryMinor <= 0
        ? null
        : (valueTryMinor - costTryMinor) / costTryMinor;

    /* Günlük değişim önceki kapanışa göre. */
    let dayChangeRatio: number | null = null;
    let dayChangeTryMinor: number | null = null;
    const prev = quote?.previousCloseMicro ?? null;
    if (priceMicro != null && prev != null && prev > 0) {
      dayChangeRatio = (priceMicro - prev) / prev;
      const prevValue = valueMinorOf(holding.quantityMicro, prev);
      const prevTry = convert(prevValue, quoteCurrency, "TRY", rates).amountMinor;
      if (valueTryMinor != null && prevTry != null) {
        dayChangeTryMinor = valueTryMinor - prevTry;
      }
    }

    items.push({
      holding,
      priceMicro,
      isManualPrice: isManual && holding.manualPriceMicro != null,
      valueMinor,
      costMinor: holding.totalCostMinor,
      valueTryMinor,
      costTryMinor,
      costTryIsEstimate,
      gainTryMinor,
      gainRatio,
      dayChangeRatio,
      dayChangeTryMinor,
      unitCostMicro: unitCostMicroOf(holding.totalCostMinor, holding.quantityMicro),
      weight: 0,
      asOf: quote?.asOf ?? null,
      fetchedAt: quote?.fetchedAt ?? null,
      quoteError: quote?.error ?? null,
    });
  }

  const totalValue = items.reduce((s, i) => s + (i.valueTryMinor ?? 0), 0);
  const totalCost = items.reduce(
    // Fiyatı bilinmeyen kalemin maliyeti de toplamdan çıkarılır; aksi halde
    // kâr/zarar oranı olmayan bir varlığın maliyetiyle bozulur.
    (s, i) => s + (i.valueTryMinor == null ? 0 : i.costTryMinor),
    0,
  );
  const totalDayChange = items.reduce((s, i) => s + (i.dayChangeTryMinor ?? 0), 0);

  for (const item of items) {
    item.weight =
      totalValue > 0 && item.valueTryMinor != null
        ? item.valueTryMinor / totalValue
        : 0;
  }

  /* Pazar bazlı dağılım. */
  const groups = new Map<string, PortfolioGroup>();
  for (const item of items) {
    const key = item.holding.market;
    const existing =
      groups.get(key) ??
      ({
        key,
        label: MARKET_LABEL[key as Market] ?? key,
        valueTryMinor: 0,
        costTryMinor: 0,
        gainTryMinor: 0,
        ratio: 0,
        count: 0,
      } satisfies PortfolioGroup);

    existing.valueTryMinor += item.valueTryMinor ?? 0;
    existing.costTryMinor += item.valueTryMinor == null ? 0 : item.costTryMinor;
    existing.gainTryMinor += item.gainTryMinor ?? 0;
    existing.count += 1;
    groups.set(key, existing);
  }
  for (const group of groups.values()) {
    group.ratio = totalValue > 0 ? group.valueTryMinor / totalValue : 0;
  }

  const fetchTimes = items
    .map((i) => i.fetchedAt)
    .filter((t): t is number => t != null);

  return {
    items: items.sort((a, b) => (b.valueTryMinor ?? -1) - (a.valueTryMinor ?? -1)),
    valueTryMinor: totalValue,
    costTryMinor: totalCost,
    gainTryMinor: totalValue - totalCost,
    gainRatio: totalCost > 0 ? (totalValue - totalCost) / totalCost : 0,
    dayChangeTryMinor: totalDayChange,
    dayChangeRatio:
      totalValue - totalDayChange > 0
        ? totalDayChange / (totalValue - totalDayChange)
        : 0,
    byMarket: [...groups.values()].sort((a, b) => b.valueTryMinor - a.valueTryMinor),
    missingPriceCount: items.filter((i) => i.priceMicro == null).length,
    missingRates: [...missingRates],
    oldestFetchedAt: fetchTimes.length > 0 ? Math.min(...fetchTimes) : null,
    errorCount: items.filter((i) => i.quoteError != null).length,
  };
}

/**
 * Yeni alım eklendiğinde pozisyonun yeni hali.
 *
 * Ağırlıklı ortalama maliyet ayrıca hesaplanmaz; toplamlar toplanır ve
 * ortalama gerektiğinde bölmeyle türetilir. Böylece her alımda bir yuvarlama
 * hatası birikmez.
 */
export function applyPurchase(
  current: { quantityMicro: number; totalCostMinor: number; totalCostTryMinor: number | null },
  purchase: { quantityMicro: number; costMinor: number; costTryMinor: number | null },
): { quantityMicro: number; totalCostMinor: number; totalCostTryMinor: number | null } {
  const quantityMicro = current.quantityMicro + purchase.quantityMicro;
  const totalCostMinor = current.totalCostMinor + purchase.costMinor;

  /* TL maliyeti ancak her iki tarafta da biliniyorsa toplanabilir. Biri
     eksikse toplam da bilinmiyor sayılır — yarısı gerçek yarısı tahmin bir
     sayı üretmek, tahmin olduğunu söylemekten kötüdür. */
  const totalCostTryMinor =
    current.totalCostTryMinor != null && purchase.costTryMinor != null
      ? current.totalCostTryMinor + purchase.costTryMinor
      : current.quantityMicro === 0
        ? purchase.costTryMinor
        : null;

  return { quantityMicro, totalCostMinor, totalCostTryMinor };
}

/**
 * Satış: adet ve maliyet oransal olarak düşülür, gerçekleşen kâr döner.
 * Ortalama maliyet yöntemi kullanılır (FIFO değil) — tek kullanıcılı kişisel
 * takipte yeterli ve girişi kolaydır.
 */
export function applySale(
  current: { quantityMicro: number; totalCostMinor: number; totalCostTryMinor: number | null },
  sale: { quantityMicro: number; proceedsMinor: number },
): {
  quantityMicro: number;
  totalCostMinor: number;
  totalCostTryMinor: number | null;
  realizedMinor: number;
} {
  const sold = Math.min(sale.quantityMicro, current.quantityMicro);
  if (sold <= 0 || current.quantityMicro <= 0) {
    return { ...current, realizedMinor: 0 };
  }

  const ratioNum = BigInt(sold);
  const ratioDen = BigInt(current.quantityMicro);

  const costOut = Number(
    roundedDiv(BigInt(current.totalCostMinor) * ratioNum, ratioDen),
  );
  const costTryOut =
    current.totalCostTryMinor == null
      ? null
      : Number(roundedDiv(BigInt(current.totalCostTryMinor) * ratioNum, ratioDen));

  return {
    quantityMicro: current.quantityMicro - sold,
    totalCostMinor: current.totalCostMinor - costOut,
    totalCostTryMinor:
      current.totalCostTryMinor == null ? null : current.totalCostTryMinor - costTryOut!,
    realizedMinor: sale.proceedsMinor - costOut,
  };
}
