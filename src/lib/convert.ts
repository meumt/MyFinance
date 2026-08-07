import { BASE_CURRENCY } from "./money";

/**
 * Para birimi çevrimi. Saf fonksiyonlar — veritabanına dokunmaz, test edilebilir
 * ve hem sunucuda hem hesaplama katmanında kullanılabilir.
 *
 * Kurlar mikro birimde tutulur: 1 birim döviz = rateMicro / 1e6 TL.
 */

export const MICRO = 1_000_000;

/** Para birimi kodu → TL karşılığı (mikro birim). */
export type RateMap = Map<string, number>;

export interface ConvertResult {
  /** Hedef para birimindeki tutar; kur bilinmiyorsa null. */
  amountMinor: number | null;
  /** Çevrim yapılamadıysa hangi para biriminin kuru eksik. */
  missingCurrency: string | null;
}

/**
 * Tutarı bir para biriminden diğerine çevirir.
 *
 * `rateOverrideMicro` verilirse (hareketin üzerinde saklanan işlem günü kuru)
 * güncel kur yerine o kullanılır — geçmiş bir harcamanın bugünkü kurla
 * yeniden değerlenmesi yanlış olur.
 */
export function convert(
  amountMinor: number,
  from: string,
  to: string,
  rates: RateMap,
  rateOverrideMicro?: number | null,
): ConvertResult {
  if (from === to) return { amountMinor, missingCurrency: null };

  // Kaynak → TL
  let inBase: number;
  if (from === BASE_CURRENCY) {
    inBase = amountMinor;
  } else {
    const rate = rateOverrideMicro ?? rates.get(from);
    if (!rate) return { amountMinor: null, missingCurrency: from };
    inBase = Math.round((amountMinor * rate) / MICRO);
  }

  if (to === BASE_CURRENCY) return { amountMinor: inBase, missingCurrency: null };

  // TL → hedef
  const targetRate = rates.get(to);
  if (!targetRate) return { amountMinor: null, missingCurrency: to };
  return {
    amountMinor: Math.round((inBase * MICRO) / targetRate),
    missingCurrency: null,
  };
}

/** Yalnızca tutarı döner; kur bilinmiyorsa null. */
export function convertOrNull(
  amountMinor: number,
  from: string,
  to: string,
  rates: RateMap,
  rateOverrideMicro?: number | null,
): number | null {
  return convert(amountMinor, from, to, rates, rateOverrideMicro).amountMinor;
}

/** Tutarı TL karşılığına çevirir. */
export function toTRY(
  amountMinor: number,
  currency: string,
  rates: RateMap,
  rateOverrideMicro?: number | null,
): number | null {
  return convertOrNull(amountMinor, currency, BASE_CURRENCY, rates, rateOverrideMicro);
}

/**
 * Kur bilinmiyorsa 0 sayar. Yalnızca toplamların çökmemesi gereken yerlerde
 * kullanılmalı; eksik kur kullanıcıya ayrıca bildirilir.
 */
export function toTRYOrZero(
  amountMinor: number,
  currency: string,
  rates: RateMap,
  rateOverrideMicro?: number | null,
): number {
  return toTRY(amountMinor, currency, rates, rateOverrideMicro) ?? 0;
}

/** Kurları biriktirirken eksik kalanları toplamak için sayaç. */
export class MissingRateTracker {
  private readonly codes = new Set<string>();
  private count = 0;

  record(currency: string | null): void {
    if (!currency) return;
    this.codes.add(currency);
    this.count += 1;
  }

  get isEmpty(): boolean {
    return this.count === 0;
  }

  summary(): { currencies: string[]; count: number } {
    return { currencies: [...this.codes].sort(), count: this.count };
  }
}
