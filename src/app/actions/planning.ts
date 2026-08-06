"use server";

import { eq } from "drizzle-orm";

import { db } from "@/db";
import {
  budgets,
  loanPayments,
  loans,
  recurringItems,
  savingsGoals,
  subscriptions,
  transactions,
} from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { addMonthsISO, dateInMonth, monthKey, today } from "@/lib/dates";
import { nextRecurring, nextRenewal } from "@/lib/forecast";
import {
  bool,
  bps,
  date,
  dayOfMonth,
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

/* ─────────────────────────────── Abonelikler ─────────────────────────────── */

export async function saveSubscriptionAction(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    await requireUser();

    const name = str(form, "name");
    if (!name) return { error: "Abonelik adı girin." };

    const amountMinor = money(form, "amount");
    if (amountMinor == null || amountMinor <= 0) {
      return { error: "Geçerli bir tutar girin." };
    }

    const paymentCardId = id(form, "paymentCardId");
    const paymentAccountId = id(form, "paymentAccountId");
    if (!paymentCardId && !paymentAccountId) {
      return { error: "Ödeme yöntemi seçin (kart ya da hesap)." };
    }

    const startDate = date(form, "startDate", today());
    const merchant = await resolveMerchant(
      optionalStr(form, "merchantName") ?? name,
      id(form, "categoryId"),
    );

    const values = {
      name,
      merchantId: merchant?.id ?? null,
      categoryId: id(form, "categoryId") ?? merchant?.defaultCategoryId ?? null,
      amountMinor,
      currency: str(form, "currency") || "TRY",
      cycle: str(form, "cycle") || "aylik",
      cycleDays: Math.round(optionalNum(form, "cycleDays") ?? 0) || null,
      startDate,
      nextRenewalDate: date(form, "nextRenewalDate", startDate),
      endDate: optionalStr(form, "endDate"),
      paymentCardId,
      paymentAccountId: paymentCardId ? null : paymentAccountId,
      autoRenew: bool(form, "autoRenew"),
      reminderDaysBefore: Math.round(optionalNum(form, "reminderDaysBefore") ?? 2),
      isActive: !bool(form, "isArchived"),
      notes: optionalStr(form, "notes"),
    };

    const editingId = id(form, "id");
    if (editingId) {
      await db.update(subscriptions).set(values).where(eq(subscriptions.id, editingId));
      revalidateAll();
      return { success: "Abonelik güncellendi.", id: editingId };
    }

    const inserted = await db
      .insert(subscriptions)
      .values(values)
      .returning({ id: subscriptions.id });
    revalidateAll();
    return { success: "Abonelik eklendi.", id: inserted[0].id };
  } catch (error) {
    return toActionError(error, "Abonelik kaydedilemedi.");
  }
}

export async function deleteSubscriptionAction(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    await requireUser();
    const subId = id(form, "id");
    if (!subId) return { error: "Abonelik bulunamadı." };
    await db.delete(subscriptions).where(eq(subscriptions.id, subId));
    revalidateAll();
    return { success: "Abonelik silindi." };
  } catch (error) {
    return toActionError(error, "Abonelik silinemedi.");
  }
}

/**
 * "Bu yenileme çekildi" işareti: hareket kaydı oluşturur ve
 * bir sonraki yenileme tarihini ileri alır.
 */
export async function markSubscriptionChargedAction(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    await requireUser();
    const subId = id(form, "id");
    if (!subId) return { error: "Abonelik bulunamadı." };

    const sub = await db.query.subscriptions.findFirst({
      where: eq(subscriptions.id, subId),
    });
    if (!sub) return { error: "Abonelik bulunamadı." };

    const chargeDate = date(form, "date", sub.nextRenewalDate);

    await db.insert(transactions).values({
      date: chargeDate,
      kind: "gider",
      amountMinor: sub.amountMinor,
      currency: sub.currency,
      accountId: sub.paymentAccountId,
      cardId: sub.paymentCardId,
      categoryId: sub.categoryId,
      merchantId: sub.merchantId,
      subscriptionId: sub.id,
      description: sub.name,
      source: "otomatik",
    });

    await db
      .update(subscriptions)
      .set({
        lastChargedDate: chargeDate,
        nextRenewalDate: nextRenewal(chargeDate, sub.cycle, sub.cycleDays),
      })
      .where(eq(subscriptions.id, subId));

    revalidateAll();
    return { success: `${sub.name} ödemesi işlendi.` };
  } catch (error) {
    return toActionError(error, "Abonelik işlenemedi.");
  }
}

/* ──────────────────────────────── Krediler ───────────────────────────────── */

/**
 * Kredi taksit planını üretir. Aylık eşit taksitli (anüite) hesap:
 * her ay ödenen faiz kalan anapara üzerinden, kalanı anaparadan düşülür.
 */
export async function saveLoanAction(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    await requireUser();

    const name = str(form, "name");
    if (!name) return { error: "Kredi adı girin." };

    const principalMinor = money(form, "principal");
    if (principalMinor == null || principalMinor <= 0) {
      return { error: "Geçerli bir kredi tutarı girin." };
    }

    const installmentCount = Math.round(optionalNum(form, "installmentCount") ?? 0);
    if (installmentCount < 1 || installmentCount > 360) {
      return { error: "Taksit sayısı 1 ile 360 arasında olmalı." };
    }

    const annualRateBps = bps(form, "annualRate");
    const monthlyRate = annualRateBps / 12 / 10000;

    // Kullanıcı taksit tutarını elle girmediyse anüite formülüyle hesaplanır.
    const manualPayment = money(form, "monthlyPayment");
    const monthlyPaymentMinor =
      manualPayment && manualPayment > 0
        ? manualPayment
        : monthlyRate > 0
          ? Math.round(
              (principalMinor * monthlyRate) /
                (1 - Math.pow(1 + monthlyRate, -installmentCount)),
            )
          : Math.round(principalMinor / installmentCount);

    const firstPaymentDate = date(form, "firstPaymentDate", today());

    const values = {
      institutionId: id(form, "institutionId"),
      name,
      type: str(form, "type") || "ihtiyac",
      principalMinor,
      currency: str(form, "currency") || "TRY",
      annualRateBps,
      installmentCount,
      monthlyPaymentMinor,
      firstPaymentDate,
      paymentAccountId: id(form, "paymentAccountId"),
      status: str(form, "status") || "aktif",
      notes: optionalStr(form, "notes"),
    };

    const editingId = id(form, "id");
    if (editingId) {
      // Takvim baştan kurulur; eski ödemeler cascade ile silinir.
      await db.delete(loans).where(eq(loans.id, editingId));
    }

    const inserted = await db.insert(loans).values(values).returning({ id: loans.id });
    const loanId = inserted[0].id;

    /* Ödeme planı */
    const paidCount = Math.round(optionalNum(form, "paidCount") ?? 0);
    let remaining = principalMinor;
    const rows: Array<typeof loanPayments.$inferInsert> = [];

    for (let seq = 1; seq <= installmentCount; seq++) {
      const interest = Math.round(remaining * monthlyRate);
      const principalPart =
        seq === installmentCount
          ? remaining
          : Math.min(remaining, monthlyPaymentMinor - interest);
      const amount =
        seq === installmentCount ? principalPart + interest : monthlyPaymentMinor;

      remaining = Math.max(0, remaining - principalPart);

      rows.push({
        loanId,
        seq,
        dueDate: addMonthsISO(firstPaymentDate, seq - 1),
        amountMinor: Math.max(0, amount),
        principalMinor: Math.max(0, principalPart),
        interestMinor: Math.max(0, interest),
        isPaid: seq <= paidCount,
      });
    }

    db.transaction((tx) => {
      for (const row of rows) tx.insert(loanPayments).values(row).run();
    });

    revalidateAll();
    return { success: "Kredi ve ödeme planı kaydedildi.", id: loanId };
  } catch (error) {
    return toActionError(error, "Kredi kaydedilemedi.");
  }
}

export async function deleteLoanAction(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    await requireUser();
    const loanId = id(form, "id");
    if (!loanId) return { error: "Kredi bulunamadı." };
    await db.delete(loans).where(eq(loans.id, loanId));
    revalidateAll();
    return { success: "Kredi silindi." };
  } catch (error) {
    return toActionError(error, "Kredi silinemedi.");
  }
}

export async function toggleLoanPaymentAction(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    await requireUser();
    const paymentId = id(form, "id");
    if (!paymentId) return { error: "Taksit bulunamadı." };

    const current = await db.query.loanPayments.findFirst({
      where: eq(loanPayments.id, paymentId),
    });
    if (!current) return { error: "Taksit bulunamadı." };

    await db
      .update(loanPayments)
      .set({ isPaid: !current.isPaid })
      .where(eq(loanPayments.id, paymentId));

    revalidateAll();
    return { success: current.isPaid ? "Ödenmedi işaretlendi." : "Ödendi işaretlendi." };
  } catch (error) {
    return toActionError(error, "Taksit güncellenemedi.");
  }
}

/* ──────────────────────── Düzenli gelir / giderler ───────────────────────── */

export async function saveRecurringAction(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    await requireUser();

    const name = str(form, "name");
    if (!name) return { error: "Ad girin." };

    const amountMinor = money(form, "amount");
    if (amountMinor == null || amountMinor <= 0) {
      return { error: "Geçerli bir tutar girin." };
    }

    const startDate = date(form, "startDate", today());
    const day = dayOfMonth(form, "dayOfMonth") ?? Number(startDate.slice(8, 10));

    const values = {
      name,
      kind: str(form, "kind") || "gelir",
      amountMinor,
      currency: str(form, "currency") || "TRY",
      cycle: str(form, "cycle") || "aylik",
      dayOfMonth: day,
      accountId: id(form, "accountId"),
      cardId: id(form, "cardId"),
      categoryId: id(form, "categoryId"),
      startDate,
      endDate: optionalStr(form, "endDate"),
      nextDate: date(form, "nextDate", dateInMonth(monthKey(startDate), day)),
      autoPost: bool(form, "autoPost"),
      isActive: !bool(form, "isArchived"),
      notes: optionalStr(form, "notes"),
    };

    const editingId = id(form, "id");
    if (editingId) {
      await db.update(recurringItems).set(values).where(eq(recurringItems.id, editingId));
    } else {
      await db.insert(recurringItems).values(values);
    }

    revalidateAll();
    return { success: "Düzenli kalem kaydedildi." };
  } catch (error) {
    return toActionError(error, "Kaydedilemedi.");
  }
}

export async function deleteRecurringAction(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    await requireUser();
    const itemId = id(form, "id");
    if (!itemId) return { error: "Kayıt bulunamadı." };
    await db.delete(recurringItems).where(eq(recurringItems.id, itemId));
    revalidateAll();
    return { success: "Silindi." };
  } catch (error) {
    return toActionError(error, "Silinemedi.");
  }
}

/** Düzenli kalemi bu dönem için işler ve bir sonraki tarihe ilerletir. */
export async function postRecurringAction(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    await requireUser();
    const itemId = id(form, "id");
    if (!itemId) return { error: "Kayıt bulunamadı." };

    const item = await db.query.recurringItems.findFirst({
      where: eq(recurringItems.id, itemId),
    });
    if (!item) return { error: "Kayıt bulunamadı." };

    const postDate = date(form, "date", item.nextDate);

    await db.insert(transactions).values({
      date: postDate,
      kind: item.kind === "gelir" ? "gelir" : "gider",
      amountMinor: item.amountMinor,
      currency: item.currency,
      accountId: item.accountId,
      cardId: item.cardId,
      categoryId: item.categoryId,
      description: item.name,
      source: "tekrarlayan",
    });

    await db
      .update(recurringItems)
      .set({ nextDate: nextRecurring(postDate, item.cycle, item.dayOfMonth) })
      .where(eq(recurringItems.id, itemId));

    revalidateAll();
    return { success: `${item.name} işlendi.` };
  } catch (error) {
    return toActionError(error, "İşlenemedi.");
  }
}

/* ───────────────────────────────── Bütçeler ──────────────────────────────── */

export async function saveBudgetAction(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    await requireUser();

    const categoryId = id(form, "categoryId");
    if (!categoryId) return { error: "Kategori seçin." };

    const amountMinor = money(form, "amount");
    if (amountMinor == null || amountMinor <= 0) {
      return { error: "Geçerli bir bütçe tutarı girin." };
    }

    // month boş bırakılırsa bütçe her ay geçerli olur.
    const month = optionalStr(form, "month");

    await db
      .insert(budgets)
      .values({
        categoryId,
        month,
        amountMinor,
        currency: str(form, "currency") || "TRY",
      })
      .onConflictDoUpdate({
        target: [budgets.categoryId, budgets.month],
        set: { amountMinor },
      });

    revalidateAll();
    return { success: "Bütçe kaydedildi." };
  } catch (error) {
    return toActionError(error, "Bütçe kaydedilemedi.");
  }
}

export async function deleteBudgetAction(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    await requireUser();
    const budgetId = id(form, "id");
    if (!budgetId) return { error: "Bütçe bulunamadı." };
    await db.delete(budgets).where(eq(budgets.id, budgetId));
    revalidateAll();
    return { success: "Bütçe silindi." };
  } catch (error) {
    return toActionError(error, "Bütçe silinemedi.");
  }
}

/* ────────────────────────────── Birikim hedefleri ────────────────────────── */

export async function saveGoalAction(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    await requireUser();

    const name = str(form, "name");
    if (!name) return { error: "Hedef adı girin." };

    const targetMinor = money(form, "target");
    if (targetMinor == null || targetMinor <= 0) {
      return { error: "Geçerli bir hedef tutarı girin." };
    }

    const values = {
      name,
      targetMinor,
      currency: str(form, "currency") || "TRY",
      targetDate: optionalStr(form, "targetDate"),
      accountId: id(form, "accountId"),
      manualSavedMinor: money(form, "manualSaved") ?? 0,
      isActive: !bool(form, "isArchived"),
      color: str(form, "color") || "#10b981",
      notes: optionalStr(form, "notes"),
    };

    const editingId = id(form, "id");
    if (editingId) {
      await db.update(savingsGoals).set(values).where(eq(savingsGoals.id, editingId));
    } else {
      await db.insert(savingsGoals).values(values);
    }

    revalidateAll();
    return { success: "Hedef kaydedildi." };
  } catch (error) {
    return toActionError(error, "Hedef kaydedilemedi.");
  }
}

export async function deleteGoalAction(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    await requireUser();
    const goalId = id(form, "id");
    if (!goalId) return { error: "Hedef bulunamadı." };
    await db.delete(savingsGoals).where(eq(savingsGoals.id, goalId));
    revalidateAll();
    return { success: "Hedef silindi." };
  } catch (error) {
    return toActionError(error, "Hedef silinemedi.");
  }
}
