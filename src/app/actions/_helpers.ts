import "server-only";

import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { db } from "@/db";
import { merchants } from "@/db/schema";
import { today, type ISODate } from "@/lib/dates";
import { parseMoneyToMinor } from "@/lib/money";
import { normalizeTr } from "@/lib/parser";

/** Aksiyonların ortak dönüş tipi — formlar bunu gösterir. */
export interface ActionState {
  error?: string;
  success?: string;
  /** Oluşturulan kaydın kimliği (arayüz seçim yapmak isteyebilir). */
  id?: number;
}

export const OK: ActionState = {};

/* ─────────────────────────── Form alanı okuma ─────────────────────────── */

export function str(form: FormData, key: string): string {
  return String(form.get(key) ?? "").trim();
}

export function optionalStr(form: FormData, key: string): string | null {
  const v = str(form, key);
  return v === "" ? null : v;
}

export function num(form: FormData, key: string, fallback = 0): number {
  const v = str(form, key);
  if (v === "") return fallback;
  const n = Number(v.replace(",", "."));
  return Number.isFinite(n) ? n : fallback;
}

export function optionalNum(form: FormData, key: string): number | null {
  const v = str(form, key);
  if (v === "") return null;
  const n = Number(v.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

export function id(form: FormData, key: string): number | null {
  const v = str(form, key);
  if (v === "" || v === "0") return null;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function bool(form: FormData, key: string): boolean {
  const v = form.get(key);
  return v === "on" || v === "true" || v === "1";
}

/** Para alanını kuruşa çevirir; geçersizse null. */
export function money(form: FormData, key: string): number | null {
  const v = str(form, key);
  if (v === "") return null;
  return parseMoneyToMinor(v);
}

export function date(form: FormData, key: string, fallback?: ISODate): ISODate {
  const v = str(form, key);
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : (fallback ?? today());
}

/** Yüzde girdisini baz puana çevirir: "45,5" → 4550 */
export function bps(form: FormData, key: string): number {
  const v = optionalNum(form, key);
  return v == null ? 0 : Math.round(v * 100);
}

/** 1-31 aralığına sıkıştırır; geçersizse null. */
export function dayOfMonth(form: FormData, key: string): number | null {
  const v = optionalNum(form, key);
  if (v == null) return null;
  const n = Math.round(v);
  return n >= 1 && n <= 31 ? n : null;
}

/* ────────────────────────── İşyeri öğrenme ────────────────────────── */

/**
 * İşyerini bulur, yoksa oluşturur ve kullanım sayacını artırır.
 * Sayaç sayesinde hızlı giriş ekranı en sık kullanılanları öne çıkarır.
 */
export async function resolveMerchant(
  name: string | null,
  defaultCategoryId?: number | null,
): Promise<{ id: number; defaultCategoryId: number | null } | null> {
  if (!name) return null;
  const clean = name.trim();
  if (clean.length === 0) return null;

  const normalized = normalizeTr(clean);
  if (normalized.length === 0) return null;

  const existing = await db.query.merchants.findFirst({
    where: eq(merchants.normalized, normalized),
  });

  if (existing) {
    await db
      .update(merchants)
      .set({
        usageCount: sql`${merchants.usageCount} + 1`,
        lastUsedAt: Date.now(),
        // Kategori daha önce boşsa bu girişten öğren.
        ...(existing.defaultCategoryId == null && defaultCategoryId
          ? { defaultCategoryId }
          : {}),
      })
      .where(eq(merchants.id, existing.id));

    return {
      id: existing.id,
      defaultCategoryId: existing.defaultCategoryId ?? defaultCategoryId ?? null,
    };
  }

  const inserted = await db
    .insert(merchants)
    .values({
      name: clean,
      normalized,
      defaultCategoryId: defaultCategoryId ?? null,
      usageCount: 1,
      lastUsedAt: Date.now(),
    })
    .returning({ id: merchants.id });

  return {
    id: inserted[0].id,
    defaultCategoryId: defaultCategoryId ?? null,
  };
}

/* ──────────────────────────── Döviz kuru damgası ───────────────────────── */

/**
 * Dövizli bir hareket kaydedilirken o günün kurunu bulur ve hareketin üzerine
 * damgalanmak üzere döner. Geçmiş bir harcamanın bugünkü kurla yeniden
 * değerlenmesi yanlış olacağı için kur hareketle birlikte saklanır.
 *
 * Kur bulunamazsa TCMB'den bir kez çekmeyi dener; yine bulunamazsa null döner
 * ve arayüz kullanıcıyı elle kur girmeye yönlendirir.
 */
export async function resolveFxRate(
  currency: string,
  date: ISODate,
): Promise<number | null> {
  if (currency === "TRY") return null;

  const { getRate, syncTcmbRates } = await import("@/lib/fx");

  const existing = await getRate(currency, date);
  if (existing) return existing;

  // Altın/gümüş TCMB'de yayınlanmıyor; boşuna ağ isteği yapma.
  if (currency === "XAU" || currency === "XAG") return null;

  await syncTcmbRates().catch(() => 0);
  return getRate(currency, date);
}

/* ─────────────────────────── Önbellek tazeleme ─────────────────────────── */

/**
 * Bir kayıt değiştiğinde bakiye, borç ve analiz sayfalarının tamamı etkilenir;
 * bu yüzden tüm yerleşimi tazelemek en güvenli yol.
 */
export function revalidateAll(): void {
  revalidatePath("/", "layout");
}

/** Hata mesajını kullanıcıya gösterilebilir hale getirir. */
export function toActionError(error: unknown, fallback: string): ActionState {
  if (error instanceof Error) {
    if (error.message === "YETKISIZ") return { error: "Oturum sona ermiş. Tekrar giriş yapın." };
    // SQLite kısıt hataları teknik metin içerir; kullanıcıya sadeleştirilmiş hali gider.
    if (error.message.includes("UNIQUE")) {
      return { error: "Bu kayıt zaten mevcut." };
    }
    if (error.message.includes("FOREIGN KEY")) {
      return { error: "Seçilen hesap veya kart bulunamadı." };
    }
  }
  console.error(fallback, error);
  return { error: fallback };
}
