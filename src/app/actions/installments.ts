"use server";

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { cards, installmentPlans, installments } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { addMonthsKeepingDay, type ISODate } from "@/lib/dates";
import { splitMinor } from "@/lib/money";
import { periodForTransaction } from "@/lib/statements";
import {
  date,
  id,
  money,
  optionalNum,
  optionalStr,
  resolveMerchant,
  revalidateAll,
  str,
  toActionError,
  type ActionState,
} from "./_helpers";

/**
 * Taksitli alışverişler. Her taksit ayrı satır olarak üretilir ve hangi
 * ekstre dönemine düştüğü baştan belirlenir — böylece gelecek ayların
 * taksit yükü kesin olarak bilinir.
 */

interface PlanInput {
  cardId: number;
  totalAmountMinor: number;
  installmentCount: number;
  description: string;
  purchaseDate: ISODate;
  currency?: string;
  merchantId?: number | null;
  categoryId?: number | null;
  notes?: string | null;
}

/**
 * Taksitleri üretir. İlk taksit, alışverişin düştüğü ekstre dönemine yazılır;
 * sonrakiler birer ay ilerler. Küsurat ilk taksitlere dağıtılır.
 */
async function createPlan(input: PlanInput): Promise<ActionState> {
  const card = await db.query.cards.findFirst({
    where: eq(cards.id, input.cardId),
  });
  if (!card) return { error: "Kart bulunamadı." };
  if (card.statementDay == null || card.dueDay == null) {
    return { error: "Bu kartın hesap kesim ve son ödeme günü tanımlı değil." };
  }

  if (input.installmentCount < 1 || input.installmentCount > 60) {
    return { error: "Taksit sayısı 1 ile 60 arasında olmalı." };
  }
  if (input.totalAmountMinor <= 0) {
    return { error: "Geçerli bir tutar girin." };
  }

  const cycle = { statementDay: card.statementDay, dueDay: card.dueDay };
  const firstPeriod = periodForTransaction(input.purchaseDate, cycle);
  const amounts = splitMinor(input.totalAmountMinor, input.installmentCount);

  const planRows = await db
    .insert(installmentPlans)
    .values({
      cardId: input.cardId,
      merchantId: input.merchantId ?? null,
      categoryId: input.categoryId ?? null,
      description: input.description,
      purchaseDate: input.purchaseDate,
      totalAmountMinor: input.totalAmountMinor,
      currency: input.currency ?? card.currency,
      installmentCount: input.installmentCount,
      paidCount: 0,
      firstDueDate: firstPeriod.dueDate,
      status: "aktif",
      notes: input.notes ?? null,
    })
    .returning({ id: installmentPlans.id });

  const planId = planRows[0].id;

  /* Banka taksiti alışveriş gününün her ayki karşılığında işler: 23'ünde
     alınan bir alışverişin taksitleri her ayın 23'ünde karta düşer. Bu işlem
     tarihi kaynaktır; hangi ekstreye girdiği ondan türetilir. */
  const rows = amounts.map((amountMinor, index) => {
    const postedDate = addMonthsKeepingDay(input.purchaseDate, index);
    const period = periodForTransaction(postedDate, cycle);
    return {
      planId,
      seq: index + 1,
      amountMinor,
      postedDate,
      // Düştüğü ekstre dönemini kesim tarihiyle işaretliyoruz.
      dueDate: period.periodEnd,
      isPaid: false,
    };
  });

  db.transaction((tx) => {
    for (const row of rows) tx.insert(installments).values(row).run();
  });

  revalidateAll();
  return {
    success: `${input.installmentCount} taksitli plan oluşturuldu.`,
    id: planId,
  };
}

/** Hızlı girişten gelen "12000/12 vestel" biçimindeki kayıt. */
export async function createInstallmentPlanFromQuick(
  input: PlanInput,
): Promise<ActionState> {
  return createPlan(input);
}

export async function savePlanAction(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    await requireUser();

    const editingId = id(form, "id");
    const cardId = id(form, "cardId");
    if (!cardId) return { error: "Kart seçin." };

    const totalAmountMinor = money(form, "totalAmount");
    if (totalAmountMinor == null || totalAmountMinor <= 0) {
      return { error: "Geçerli bir toplam tutar girin." };
    }

    const installmentCount = Math.round(optionalNum(form, "installmentCount") ?? 0);
    const description = str(form, "description");
    if (!description) return { error: "Açıklama girin." };

    const merchant = await resolveMerchant(
      optionalStr(form, "merchantName"),
      id(form, "categoryId"),
    );

    /* Düzenlemede taksit takvimi baştan kurulur; tutar ya da taksit sayısı
       değişmiş olabilir. Eski satırlar cascade ile silinir. */
    if (editingId) {
      await db.delete(installmentPlans).where(eq(installmentPlans.id, editingId));
    }

    return await createPlan({
      cardId,
      totalAmountMinor,
      installmentCount,
      description,
      purchaseDate: date(form, "purchaseDate"),
      currency: str(form, "currency") || undefined,
      merchantId: merchant?.id ?? null,
      categoryId: id(form, "categoryId") ?? merchant?.defaultCategoryId ?? null,
      notes: optionalStr(form, "notes"),
    });
  } catch (error) {
    return toActionError(error, "Taksit planı kaydedilemedi.");
  }
}

export async function deletePlanAction(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    await requireUser();
    const planId = id(form, "id");
    if (!planId) return { error: "Plan bulunamadı." };

    await db.delete(installmentPlans).where(eq(installmentPlans.id, planId));
    revalidateAll();
    return { success: "Taksit planı silindi." };
  } catch (error) {
    return toActionError(error, "Taksit planı silinemedi.");
  }
}
