"use server";

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { transactions } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { today } from "@/lib/dates";
import { parseQuickEntry } from "@/lib/parser";
import {
  bool,
  date,
  id,
  money,
  optionalStr,
  resolveMerchant,
  revalidateAll,
  str,
  toActionError,
  type ActionState,
} from "./_helpers";

/**
 * Hareket kayıtları. Tutar her zaman pozitif saklanır; yönü `kind` belirler.
 * Kaynak (hesap ya da kart) zorunludur — aksi halde bakiyeye yansımaz.
 */

const VALID_KINDS = new Set([
  "gider",
  "gelir",
  "transfer",
  "kart_odeme",
  "faiz",
  "ucret",
  "iade",
]);

export async function saveTransactionAction(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    await requireUser();

    const editingId = id(form, "id");
    const kind = str(form, "kind") || "gider";
    if (!VALID_KINDS.has(kind)) return { error: "Geçersiz hareket türü." };

    const amountMinor = money(form, "amount");
    if (amountMinor == null || amountMinor === 0) {
      return { error: "Geçerli bir tutar girin." };
    }

    const accountId = id(form, "accountId");
    const cardId = id(form, "cardId");
    const counterAccountId = id(form, "counterAccountId");
    const counterCardId = id(form, "counterCardId");

    if (kind === "transfer") {
      if (!accountId || !counterAccountId) {
        return { error: "Transfer için gönderen ve alan hesap seçin." };
      }
      if (accountId === counterAccountId) {
        return { error: "Gönderen ve alan hesap aynı olamaz." };
      }
    } else if (kind === "kart_odeme") {
      if (!accountId || !counterCardId) {
        return { error: "Kart ödemesi için ödeyen hesap ve ödenen kart seçin." };
      }
    } else if (!accountId && !cardId) {
      return { error: "Hesap ya da kart seçin." };
    }

    const merchantName = optionalStr(form, "merchantName");
    const categoryId = id(form, "categoryId");
    const merchant = await resolveMerchant(merchantName, categoryId);

    const values = {
      date: date(form, "date"),
      kind,
      amountMinor: Math.abs(amountMinor),
      currency: str(form, "currency") || "TRY",
      accountId,
      cardId,
      counterAccountId: kind === "transfer" ? counterAccountId : null,
      counterCardId: kind === "kart_odeme" ? counterCardId : null,
      categoryId: categoryId ?? merchant?.defaultCategoryId ?? null,
      merchantId: merchant?.id ?? null,
      description: optionalStr(form, "description"),
      note: optionalStr(form, "note"),
      updatedAt: Date.now(),
    };

    if (editingId) {
      await db.update(transactions).set(values).where(eq(transactions.id, editingId));
      revalidateAll();
      return { success: "Hareket güncellendi.", id: editingId };
    }

    const inserted = await db
      .insert(transactions)
      .values({ ...values, source: "manuel" })
      .returning({ id: transactions.id });

    revalidateAll();
    return { success: "Hareket eklendi.", id: inserted[0].id };
  } catch (error) {
    return toActionError(error, "Hareket kaydedilemedi.");
  }
}

export async function deleteTransactionAction(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    await requireUser();
    const txId = id(form, "id");
    if (!txId) return { error: "Kayıt bulunamadı." };

    await db.delete(transactions).where(eq(transactions.id, txId));
    revalidateAll();
    return { success: "Hareket silindi." };
  } catch (error) {
    return toActionError(error, "Hareket silinemedi.");
  }
}

/* ────────────────────────────── Hızlı giriş ────────────────────────────── */

export interface QuickAddState extends ActionState {
  /** Ayrıştırma sonucu — arayüz kullanıcıya ne anladığını gösterir. */
  preview?: {
    amountMinor: number;
    merchantName: string;
    kind: string;
    installmentCount: number | null;
    date: string;
  };
}

/**
 * Tek satır metinden hareket oluşturur: "250 migros".
 * Kaynak (kart/hesap) ve kategori seçimi formdan gelir; işyeri
 * daha önce kullanılmışsa kategorisi otomatik atanır.
 */
export async function quickAddAction(
  _prev: QuickAddState,
  form: FormData,
): Promise<QuickAddState> {
  try {
    await requireUser();

    const text = str(form, "text");
    if (!text) return { error: "Bir şeyler yazın: örn. \"250 migros\"" };

    const parsed = parseQuickEntry(text, today());
    if (parsed.amountMinor == null || parsed.amountMinor === 0) {
      return { error: "Tutar okunamadı. Örnek: \"250 migros\"" };
    }

    const sourceRaw = str(form, "source"); // "hesap:3" veya "kart:5"
    const [sourceType, sourceIdRaw] = sourceRaw.split(":");
    const sourceId = Number(sourceIdRaw);

    if (!sourceType || !Number.isInteger(sourceId) || sourceId <= 0) {
      return { error: "Ödeme kaynağı seçin." };
    }

    const explicitCategoryId = id(form, "categoryId");
    const merchant = await resolveMerchant(parsed.merchantName, explicitCategoryId);

    // Taksitli girişler ayrı bir akışa yönlendirilir; burada uyarı veriyoruz.
    if (parsed.installmentCount && sourceType !== "kart") {
      return { error: "Taksitli alışveriş yalnızca kredi kartına girilebilir." };
    }

    if (parsed.installmentCount && sourceType === "kart") {
      const { createInstallmentPlanFromQuick } = await import("./installments");
      return createInstallmentPlanFromQuick({
        cardId: sourceId,
        totalAmountMinor: parsed.amountMinor,
        installmentCount: parsed.installmentCount,
        description: parsed.merchantName || "Taksitli alışveriş",
        purchaseDate: parsed.date,
        merchantId: merchant?.id ?? null,
        categoryId: explicitCategoryId ?? merchant?.defaultCategoryId ?? null,
      });
    }

    await db.insert(transactions).values({
      date: parsed.date,
      kind: parsed.kind,
      amountMinor: parsed.amountMinor,
      currency: str(form, "currency") || "TRY",
      accountId: sourceType === "hesap" ? sourceId : null,
      cardId: sourceType === "kart" ? sourceId : null,
      categoryId: explicitCategoryId ?? merchant?.defaultCategoryId ?? null,
      merchantId: merchant?.id ?? null,
      description: parsed.merchantName || null,
      source: "manuel",
    });

    revalidateAll();
    return {
      success: "Eklendi",
      preview: {
        amountMinor: parsed.amountMinor,
        merchantName: parsed.merchantName,
        kind: parsed.kind,
        installmentCount: parsed.installmentCount,
        date: parsed.date,
      },
    };
  } catch (error) {
    return toActionError(error, "Hızlı giriş kaydedilemedi.");
  }
}

/* ─────────────────────────── Toplu içe aktarma ─────────────────────────── */

export interface BulkImportRow {
  date: string;
  description: string;
  amountMinor: number;
  kind: "gider" | "gelir";
  categoryId: number | null;
  skip: boolean;
}

/**
 * Onaylanmış ekstre satırlarını topluca kaydeder.
 * Satırlar tek işlemde yazılır; biri hata verirse hiçbiri yazılmaz.
 */
export async function bulkImportAction(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    await requireUser();

    const payload = str(form, "rows");
    if (!payload) return { error: "Kaydedilecek satır yok." };

    const rows = JSON.parse(payload) as BulkImportRow[];
    const accepted = rows.filter((r) => !r.skip && r.amountMinor > 0);
    if (accepted.length === 0) return { error: "Kaydedilecek satır seçilmedi." };

    const sourceRaw = str(form, "source");
    const [sourceType, sourceIdRaw] = sourceRaw.split(":");
    const sourceId = Number(sourceIdRaw);
    if (!sourceType || !Number.isInteger(sourceId) || sourceId <= 0) {
      return { error: "Hedef hesap ya da kart seçin." };
    }

    const currency = str(form, "currency") || "TRY";
    const learnMerchants = bool(form, "learnMerchants");

    const prepared: Array<typeof transactions.$inferInsert> = [];
    for (const row of accepted) {
      const merchant = learnMerchants
        ? await resolveMerchant(row.description, row.categoryId)
        : null;

      prepared.push({
        date: row.date,
        kind: row.kind,
        amountMinor: Math.abs(row.amountMinor),
        currency,
        accountId: sourceType === "hesap" ? sourceId : null,
        cardId: sourceType === "kart" ? sourceId : null,
        categoryId: row.categoryId ?? merchant?.defaultCategoryId ?? null,
        merchantId: merchant?.id ?? null,
        description: row.description,
        source: "toplu" as const,
      });
    }

    db.transaction((tx) => {
      for (const values of prepared) {
        tx.insert(transactions).values(values).run();
      }
    });

    revalidateAll();
    return { success: `${prepared.length} hareket kaydedildi.` };
  } catch (error) {
    return toActionError(error, "Toplu kayıt başarısız.");
  }
}
