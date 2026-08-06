"use server";

import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import {
  accounts,
  balanceSnapshots,
  cards,
  categories,
  institutions,
} from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { today } from "@/lib/dates";
import {
  bool,
  bps,
  date,
  dayOfMonth,
  id,
  money,
  optionalNum,
  optionalStr,
  revalidateAll,
  str,
  toActionError,
  type ActionState,
} from "./_helpers";

/* ───────────────────────────────── Hesaplar ──────────────────────────────── */

export async function saveAccountAction(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    await requireUser();

    const name = str(form, "name");
    if (!name) return { error: "Hesap adı girin." };

    const openingBalance = money(form, "openingBalance") ?? 0;

    const values = {
      institutionId: id(form, "institutionId"),
      name,
      type: str(form, "type") || "vadesiz",
      currency: str(form, "currency") || "TRY",
      iban: optionalStr(form, "iban")?.replace(/\s/g, "") ?? null,
      openingBalanceMinor: openingBalance,
      openingDate: date(form, "openingDate", today()),
      overdraftLimitMinor: money(form, "overdraftLimit") ?? 0,
      overdraftRateBps: bps(form, "overdraftRate"),
      maturityDate: optionalStr(form, "maturityDate"),
      interestRateBps: bps(form, "interestRate"),
      isActive: !bool(form, "isArchived"),
      excludeFromNetWorth: bool(form, "excludeFromNetWorth"),
      color: str(form, "color") || "#0ea5e9",
      notes: optionalStr(form, "notes"),
    };

    const editingId = id(form, "id");
    if (editingId) {
      await db.update(accounts).set(values).where(eq(accounts.id, editingId));
      revalidateAll();
      return { success: "Hesap güncellendi.", id: editingId };
    }

    const inserted = await db
      .insert(accounts)
      .values(values)
      .returning({ id: accounts.id });
    revalidateAll();
    return { success: "Hesap eklendi.", id: inserted[0].id };
  } catch (error) {
    return toActionError(error, "Hesap kaydedilemedi.");
  }
}

export async function deleteAccountAction(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    await requireUser();
    const accountId = id(form, "id");
    if (!accountId) return { error: "Hesap bulunamadı." };

    // Hareketler cascade ile silinir; kullanıcı bunu formda uyarı olarak görür.
    await db.delete(accounts).where(eq(accounts.id, accountId));
    revalidateAll();
    return { success: "Hesap ve bağlı hareketleri silindi." };
  } catch (error) {
    return toActionError(error, "Hesap silinemedi.");
  }
}

/**
 * Bakiye mutabakatı: "bugün hesapta gerçekte şu kadar var" düzeltmesi.
 * Sonraki hesaplamalar bu tarihten itibaren yeniden başlar.
 */
export async function saveBalanceSnapshotAction(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    await requireUser();

    const accountId = id(form, "accountId");
    if (!accountId) return { error: "Hesap seçin." };

    const balanceMinor = money(form, "balance");
    if (balanceMinor == null) return { error: "Geçerli bir bakiye girin." };

    const snapshotDate = date(form, "date", today());

    const existing = await db.query.balanceSnapshots.findFirst({
      where: and(
        eq(balanceSnapshots.accountId, accountId),
        eq(balanceSnapshots.date, snapshotDate),
      ),
    });

    if (existing) {
      await db
        .update(balanceSnapshots)
        .set({ balanceMinor, note: optionalStr(form, "note") })
        .where(eq(balanceSnapshots.id, existing.id));
    } else {
      await db.insert(balanceSnapshots).values({
        accountId,
        date: snapshotDate,
        balanceMinor,
        note: optionalStr(form, "note"),
      });
    }

    revalidateAll();
    return { success: "Bakiye güncellendi." };
  } catch (error) {
    return toActionError(error, "Bakiye kaydedilemedi.");
  }
}

/* ────────────────────────────────── Kartlar ──────────────────────────────── */

export async function saveCardAction(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    await requireUser();

    const name = str(form, "name");
    if (!name) return { error: "Kart adı girin." };

    const type = str(form, "type") || "kredi";
    const statementDay = dayOfMonth(form, "statementDay");
    const dueDay = dayOfMonth(form, "dueDay");

    // Kredi ve sanal kartlar ekstre döngüsü olmadan borç hesaplayamaz.
    if ((type === "kredi" || type === "sanal") && (!statementDay || !dueDay)) {
      return {
        error: "Kredi/sanal kart için hesap kesim ve son ödeme günü zorunlu.",
      };
    }

    const parentCardId = id(form, "parentCardId");
    const editingId = id(form, "id");

    if (parentCardId && editingId && parentCardId === editingId) {
      return { error: "Kart kendisine bağlanamaz." };
    }

    const values = {
      institutionId: id(form, "institutionId"),
      name,
      type,
      parentCardId,
      sharesParentLimit: parentCardId ? bool(form, "sharesParentLimit") : true,
      lastFour: optionalStr(form, "lastFour")?.slice(-4) ?? null,
      network: optionalStr(form, "network"),
      currency: str(form, "currency") || "TRY",
      creditLimitMinor: money(form, "creditLimit") ?? 0,
      cashAdvanceLimitMinor: money(form, "cashAdvanceLimit") ?? 0,
      statementDay,
      dueDay,
      linkedAccountId: id(form, "linkedAccountId"),
      autoPayMode: str(form, "autoPayMode") || "yok",
      openingDebtMinor: money(form, "openingDebt") ?? 0,
      isActive: !bool(form, "isArchived"),
      color: str(form, "color") || "#8b5cf6",
      notes: optionalStr(form, "notes"),
    };

    if (editingId) {
      await db.update(cards).set(values).where(eq(cards.id, editingId));
      revalidateAll();
      return { success: "Kart güncellendi.", id: editingId };
    }

    const inserted = await db
      .insert(cards)
      .values(values)
      .returning({ id: cards.id });
    revalidateAll();
    return { success: "Kart eklendi.", id: inserted[0].id };
  } catch (error) {
    return toActionError(error, "Kart kaydedilemedi.");
  }
}

export async function deleteCardAction(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    await requireUser();
    const cardId = id(form, "id");
    if (!cardId) return { error: "Kart bulunamadı." };

    const children = await db.query.cards.findMany({
      where: eq(cards.parentCardId, cardId),
    });
    if (children.length > 0) {
      return {
        error: `Bu karta bağlı ${children.length} sanal kart var. Önce onları silin veya bağlantıyı kaldırın.`,
      };
    }

    await db.delete(cards).where(eq(cards.id, cardId));
    revalidateAll();
    return { success: "Kart ve bağlı hareketleri silindi." };
  } catch (error) {
    return toActionError(error, "Kart silinemedi.");
  }
}

/* ──────────────────────────────── Kurumlar ───────────────────────────────── */

export async function saveInstitutionAction(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    await requireUser();
    const name = str(form, "name");
    if (!name) return { error: "Kurum adı girin." };

    const values = {
      name,
      shortName: optionalStr(form, "shortName"),
      color: str(form, "color") || "#64748b",
      isActive: !bool(form, "isArchived"),
    };

    const editingId = id(form, "id");
    if (editingId) {
      await db.update(institutions).set(values).where(eq(institutions.id, editingId));
    } else {
      await db.insert(institutions).values(values);
    }

    revalidateAll();
    return { success: "Kurum kaydedildi." };
  } catch (error) {
    return toActionError(error, "Kurum kaydedilemedi.");
  }
}

/* ─────────────────────────────── Kategoriler ─────────────────────────────── */

export async function saveCategoryAction(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    await requireUser();
    const name = str(form, "name");
    if (!name) return { error: "Kategori adı girin." };

    const editingId = id(form, "id");
    const parentId = id(form, "parentId");
    if (parentId && editingId && parentId === editingId) {
      return { error: "Kategori kendisinin alt kategorisi olamaz." };
    }

    const values = {
      name,
      parentId,
      kind: str(form, "kind") || "gider",
      color: str(form, "color") || "#94a3b8",
      icon: optionalStr(form, "icon"),
      isEssential: bool(form, "isEssential"),
      isActive: !bool(form, "isArchived"),
      sortOrder: Math.round(optionalNum(form, "sortOrder") ?? 0),
    };

    if (editingId) {
      await db.update(categories).set(values).where(eq(categories.id, editingId));
    } else {
      await db.insert(categories).values(values);
    }

    revalidateAll();
    return { success: "Kategori kaydedildi." };
  } catch (error) {
    return toActionError(error, "Kategori kaydedilemedi.");
  }
}

export async function deleteCategoryAction(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    await requireUser();
    const categoryId = id(form, "id");
    if (!categoryId) return { error: "Kategori bulunamadı." };

    const children = await db.query.categories.findMany({
      where: eq(categories.parentId, categoryId),
    });
    if (children.length > 0) {
      return { error: "Önce alt kategorileri silin veya taşıyın." };
    }

    // Hareketlerin kategorisi NULL'a düşer, hareketler korunur.
    await db.delete(categories).where(eq(categories.id, categoryId));
    revalidateAll();
    return { success: "Kategori silindi." };
  } catch (error) {
    return toActionError(error, "Kategori silinemedi.");
  }
}
