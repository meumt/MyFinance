"use server";

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { holdings } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import {
  applyPurchase,
  applySale,
  isMarket,
  MARKET_CURRENCY,
  MARKET_PROVIDER,
  QTY_SCALE,
  PRICE_SCALE,
} from "@/lib/portfolio";
import { probeFonoloji, refreshQuotes } from "@/lib/quotes";
import { getSettings } from "@/lib/settings";
import {
  bool,
  id,
  money,
  optionalNum,
  optionalStr,
  revalidateAll,
  str,
  toActionError,
  type ActionState,
} from "./_helpers";

/**
 * Yatırım kalemleri. Adet ve fiyat tam sayı ölçeklerinde tutulur; form
 * girdileri burada bir kez çevrilir ki hesaplama katmanı hiç float görmesin.
 */

/** "1.234,5678" → adet × 1e6. Fon pay adedi kesirli olabilir. */
function quantity(form: FormData, key: string): number | null {
  const raw = str(form, key);
  if (raw === "") return null;

  /* Binlik ayırıcıyı at, ondalık ayırıcıyı normalize et. Son görülen
     ayırıcı ondalık noktasıdır. */
  const lastComma = raw.lastIndexOf(",");
  const lastDot = raw.lastIndexOf(".");
  let normalized = raw.replace(/[^\d,.]/g, "");
  if (lastComma > lastDot) normalized = normalized.replace(/\./g, "").replace(",", ".");
  else if (lastDot > lastComma) normalized = normalized.replace(/,/g, "");
  else normalized = normalized.replace(",", ".");

  const value = Number(normalized);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * QTY_SCALE);
}

/** Birim fiyat girdisi → fiyat × 1e6. Fon birim pay değeri kuruştan küçüktür. */
function unitPrice(form: FormData, key: string): number | null {
  const value = optionalNum(form, key);
  if (value == null || value <= 0) return null;
  return Math.round(value * PRICE_SCALE);
}

export async function saveHoldingAction(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    await requireUser();

    const holdingId = id(form, "id");
    const marketRaw = str(form, "market");
    if (!isMarket(marketRaw)) return { error: "Pazar seçin." };

    const symbol = str(form, "symbol").toUpperCase();
    if (symbol === "") return { error: "Kod/sembol girin." };

    const qty = quantity(form, "quantity");
    if (qty == null) return { error: "Adet geçerli bir sayı olmalı." };

    const cost = money(form, "totalCost");
    if (cost == null || cost < 0) {
      return { error: "Toplam maliyet geçerli bir tutar olmalı." };
    }

    /* Kullanıcı sağlayıcıyı seçmezse pazara göre varsayılan atanır: TEFAS →
       Fonoloji, BIST/NASDAQ → Yahoo. */
    const providerRaw = str(form, "provider");
    const provider =
      providerRaw === "fonoloji" || providerRaw === "yahoo" || providerRaw === "manuel"
        ? providerRaw
        : MARKET_PROVIDER[marketRaw];

    const currency = str(form, "currency") || MARKET_CURRENCY[marketRaw];

    const values = {
      kind: str(form, "kind") === "fon" ? "fon" : "hisse",
      market: marketRaw,
      symbol,
      name: str(form, "name"),
      currency,
      quantityMicro: qty,
      totalCostMinor: cost,
      /* Dövizli kalemde ödenen TL ayrıca sorulur; boşsa bilinmiyor sayılır ve
         maliyet bugünkü kurdan tahmin edilir (arayüz bunu belirtir). */
      totalCostTryMinor:
        currency === "TRY" ? cost : (money(form, "totalCostTry") ?? null),
      provider,
      manualPriceMicro: unitPrice(form, "manualPrice"),
      brokerAccountId: id(form, "brokerAccountId"),
      isActive: !form.has("isActive") || bool(form, "isActive"),
      excludeFromNetWorth: bool(form, "excludeFromNetWorth"),
      notes: optionalStr(form, "notes"),
    };

    if (holdingId) {
      await db.update(holdings).set(values).where(eq(holdings.id, holdingId));
      const updated = await db.query.holdings.findFirst({
        where: eq(holdings.id, holdingId),
      });
      /* Yalnızca bu kalemin fiyatı tazelenir. Tümünü zorla çekmek, hız
         sınırına takılmış sembollere de yeniden gitmek demektir. */
      if (updated) {
        await refreshQuotes({ holdings: [updated], force: true }).catch(
          () => undefined,
        );
      }
      revalidateAll();
      return { success: `${symbol} güncellendi.` };
    }

    const inserted = await db
      .insert(holdings)
      .values(values)
      .returning();

    /* Yeni kalemin fiyatı hemen çekilir: kullanıcı kaydettikten sonra
       değerini görmek için TTL dolmasını beklemesin. */
    await refreshQuotes({ holdings: inserted, force: true }).catch(
      () => undefined,
    );
    revalidateAll();
    return { success: `${symbol} eklendi.`, id: inserted[0].id };
  } catch (error) {
    return toActionError(error, "Yatırım kaydedilemedi.");
  }
}

/**
 * Mevcut kaleme alım ekler. Ağırlıklı ortalama maliyet kendiliğinden
 * güncellenir — kullanıcı ortalamayı elle hesaplamak zorunda kalmaz.
 */
export async function addPurchaseAction(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    await requireUser();

    const holdingId = id(form, "id");
    if (!holdingId) return { error: "Kalem bulunamadı." };

    const current = await db.query.holdings.findFirst({
      where: eq(holdings.id, holdingId),
    });
    if (!current) return { error: "Kalem bulunamadı." };

    const qty = quantity(form, "quantity");
    if (qty == null || qty <= 0) return { error: "Alınan adedi girin." };

    const cost = money(form, "cost");
    if (cost == null || cost <= 0) return { error: "Ödenen tutarı girin." };

    const next = applyPurchase(
      {
        quantityMicro: current.quantityMicro,
        totalCostMinor: current.totalCostMinor,
        totalCostTryMinor: current.totalCostTryMinor,
      },
      {
        quantityMicro: qty,
        costMinor: cost,
        costTryMinor:
          current.currency === "TRY" ? cost : (money(form, "costTry") ?? null),
      },
    );

    await db.update(holdings).set(next).where(eq(holdings.id, holdingId));
    revalidateAll();
    return { success: `${current.symbol} alımı eklendi.` };
  } catch (error) {
    return toActionError(error, "Alım eklenemedi.");
  }
}

/**
 * Satış. Maliyet oransal düşülür ve gerçekleşen kâr/zarar bildirilir.
 * Ortalama maliyet yöntemi kullanılır.
 */
export async function addSaleAction(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    await requireUser();

    const holdingId = id(form, "id");
    if (!holdingId) return { error: "Kalem bulunamadı." };

    const current = await db.query.holdings.findFirst({
      where: eq(holdings.id, holdingId),
    });
    if (!current) return { error: "Kalem bulunamadı." };

    const qty = quantity(form, "quantity");
    if (qty == null || qty <= 0) return { error: "Satılan adedi girin." };
    if (qty > current.quantityMicro) {
      return { error: "Elinizdekinden fazlasını satamazsınız." };
    }

    const proceeds = money(form, "proceeds");
    if (proceeds == null || proceeds < 0) return { error: "Gelen tutarı girin." };

    const result = applySale(
      {
        quantityMicro: current.quantityMicro,
        totalCostMinor: current.totalCostMinor,
        totalCostTryMinor: current.totalCostTryMinor,
      },
      { quantityMicro: qty, proceedsMinor: proceeds },
    );

    await db
      .update(holdings)
      .set({
        quantityMicro: result.quantityMicro,
        totalCostMinor: result.totalCostMinor,
        totalCostTryMinor: result.totalCostTryMinor,
        // Tamamı satıldıysa kalem listede yer tutmasın.
        isActive: result.quantityMicro > 0,
      })
      .where(eq(holdings.id, holdingId));

    revalidateAll();
    const sign = result.realizedMinor >= 0 ? "kâr" : "zarar";
    return {
      success: `Satış kaydedildi. Gerçekleşen ${sign}: ${(Math.abs(result.realizedMinor) / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2 })} ${current.currency}`,
    };
  } catch (error) {
    return toActionError(error, "Satış kaydedilemedi.");
  }
}

export async function deleteHoldingAction(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    await requireUser();
    const holdingId = id(form, "id");
    if (!holdingId) return { error: "Kalem bulunamadı." };

    await db.delete(holdings).where(eq(holdings.id, holdingId));
    revalidateAll();
    return { success: "Kalem silindi." };
  } catch (error) {
    return toActionError(error, "Kalem silinemedi.");
  }
}

/** Fiyatları zorla yeniler — TTL beklemeden. */
export async function refreshQuotesAction(
  _prev: ActionState,
  _form: FormData,
): Promise<ActionState> {
  try {
    await requireUser();
    const result = await refreshQuotes({ force: true });
    revalidateAll();

    if (result.fetched === 0 && result.failed === 0) {
      return { success: "Fiyat çekilecek kalem yok." };
    }
    if (result.failed > 0) {
      return {
        success: result.fetched > 0 ? `${result.fetched} fiyat güncellendi.` : undefined,
        error: result.errors.slice(0, 3).join(" · "),
      };
    }
    return { success: `${result.fetched} fiyat güncellendi.` };
  } catch (error) {
    return toActionError(error, "Fiyatlar güncellenemedi.");
  }
}

/**
 * Fonoloji bağlantısını sınar ve HAM yanıtı gösterir.
 *
 * Alan adları doğrulanamadığı için gerekli: fiyat okunamıyorsa kullanıcı
 * yanıtın kendisini görüp bize iletebilir, biz de tahmin yerine gerçek adı
 * ekleyebiliriz.
 */
export async function probeFonolojiAction(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    await requireUser();
    const settings = await getSettings();
    if (!settings.fonolojiApiKey) {
      return { error: "Önce Fonoloji API anahtarını kaydedin." };
    }

    const code = str(form, "code") || "AFA";
    const result = await probeFonoloji(code, settings.fonolojiApiKey);
    return result.ok ? { success: result.detail } : { error: result.detail };
  } catch (error) {
    return toActionError(error, "Fonoloji sınanamadı.");
  }
}
