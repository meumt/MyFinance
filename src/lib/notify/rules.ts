import "server-only";

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { notifications } from "@/db/schema";
import { loadSnapshot, type FinancialSnapshot } from "../data";
import { formatDateTR, relativeDayTR, today, type ISODate } from "../dates";
import { upcomingObligations } from "../forecast";
import { toTRYOrZero } from "../fx";
import { formatMoney, formatPercent } from "../money";
import { deliver, type DeliveryResult } from "./channels";

/**
 * Uyarı üretim kuralları. Her uyarının benzersiz bir `dedupeKey`'i vardır;
 * aynı uyarı aynı gün ikinci kez gönderilmez.
 */

export interface PendingNotification {
  dedupeKey: string;
  type: string;
  severity: "bilgi" | "uyari" | "kritik";
  title: string;
  body: string;
  targetDate: ISODate | null;
  entityType: string | null;
  entityId: number | null;
}

export function buildNotifications(snap: FinancialSnapshot): PendingNotification[] {
  const out: PendingNotification[] = [];
  const ref = snap.ref;
  const reminderDays = new Set(snap.settings.dueReminderDays);
  const maxReminder = Math.max(...snap.settings.dueReminderDays, 7);

  const obligations = upcomingObligations(snap, {
    days: maxReminder + 2,
    includeOverdue: true,
  });

  /* 1) Kart ekstresi son ödeme uyarıları */
  for (const o of obligations) {
    if (o.type !== "kart_ekstre") continue;

    const overdue = o.daysUntil < 0;
    if (!overdue && !reminderDays.has(o.daysUntil)) continue;

    const card = snap.cardById.get(o.entityId);
    const minimum =
      o.minimumMinor != null && o.minimumMinor > 0
        ? `\nAsgari ödeme: ${formatMoney(o.minimumMinor, o.currency)}`
        : "";

    /* Ödeme günü hesapta yeterli para var mı? */
    let coverage = "";
    if (card?.linkedAccountId) {
      const balance = snap.balances.get(card.linkedAccountId);
      const account = snap.accountById.get(card.linkedAccountId);
      if (balance && account) {
        const spendable = toTRYOrZero(
          balance.spendableMinor,
          account.currency,
          snap.rates,
        );
        if (spendable < o.amountMinor) {
          coverage = `\n\n⚠️ ${account.name} hesabında ${formatMoney(spendable)} var, ${formatMoney(o.amountMinor - spendable)} eksik.`;
        }
      }
    }

    out.push({
      dedupeKey: `kart-son-odeme-${o.entityId}-${o.date}-${ref}`,
      type: "kart_son_odeme",
      severity: overdue ? "kritik" : o.daysUntil <= 1 ? "kritik" : "uyari",
      title: overdue
        ? `${o.label} ödemesi gecikti`
        : `${o.label} son ödeme ${relativeDayTR(o.date, ref)}`,
      body:
        `Dönem borcu: ${formatMoney(o.originalAmountMinor, o.currency)}` +
        minimum +
        `\nSon ödeme: ${formatDateTR(o.date)}` +
        coverage,
      targetDate: o.date,
      entityType: "kart",
      entityId: o.entityId,
    });
  }

  /* 2) Kredi taksitleri */
  for (const o of obligations) {
    if (o.type !== "kredi_taksit") continue;
    const overdue = o.daysUntil < 0;
    if (!overdue && !reminderDays.has(o.daysUntil)) continue;

    out.push({
      dedupeKey: `kredi-taksit-${o.entityId}-${ref}`,
      type: "kredi_taksit",
      severity: overdue ? "kritik" : "uyari",
      title: overdue
        ? `${o.label} taksiti gecikti`
        : `${o.label} taksiti ${relativeDayTR(o.date, ref)}`,
      body: `${o.detail}\nTutar: ${formatMoney(o.originalAmountMinor, o.currency)}\nVade: ${formatDateTR(o.date)}`,
      targetDate: o.date,
      entityType: "kredi",
      entityId: o.entityId,
    });
  }

  /* 3) Abonelik yenilemeleri */
  for (const sub of snap.subscriptions) {
    if (!sub.isActive) continue;

    const daysUntil = daysDiff(ref, sub.nextRenewalDate);
    if (daysUntil < 0 || daysUntil > sub.reminderDaysBefore) continue;

    const method = sub.paymentCardId
      ? snap.cardById.get(sub.paymentCardId)?.name
      : sub.paymentAccountId
        ? snap.accountById.get(sub.paymentAccountId)?.name
        : null;

    /* Kartla ödeniyorsa limit yetiyor mu? */
    let limitWarning = "";
    if (sub.paymentCardId) {
      const ledger = snap.ledgers.get(sub.paymentCardId);
      const amountTL = toTRYOrZero(sub.amountMinor, sub.currency, snap.rates);
      if (ledger && ledger.availableLimitMinor < amountTL) {
        limitWarning = `\n\n⚠️ Kartta kullanılabilir limit ${formatMoney(ledger.availableLimitMinor)} — yenileme başarısız olabilir.`;
      }
    }

    out.push({
      dedupeKey: `abonelik-${sub.id}-${sub.nextRenewalDate}`,
      type: "abonelik_yenileme",
      severity: limitWarning ? "uyari" : "bilgi",
      title:
        daysUntil === 0
          ? `${sub.name} bugün yenileniyor`
          : `${sub.name} ${relativeDayTR(sub.nextRenewalDate, ref)} yenilenecek`,
      body:
        `Tutar: ${formatMoney(sub.amountMinor, sub.currency)}` +
        (method ? `\nÖdeme: ${method}` : "") +
        limitWarning,
      targetDate: sub.nextRenewalDate,
      entityType: "abonelik",
      entityId: sub.id,
    });
  }

  /* 4) Kart limiti doluluk uyarısı */
  const warnRatio = snap.settings.cardUtilizationWarnPercent / 100;
  for (const card of snap.cards) {
    if (!card.isActive || card.creditLimitMinor <= 0) continue;
    // Sanal kart ana kartın limitini paylaşıyorsa uyarı ana kartta verilir.
    if (card.parentCardId && card.sharesParentLimit) continue;

    const ledger = snap.ledgers.get(card.id);
    if (!ledger || ledger.utilizationRatio < warnRatio) continue;

    out.push({
      dedupeKey: `kart-limit-${card.id}-${ref}`,
      type: "kart_limit",
      severity: ledger.utilizationRatio >= 1 ? "kritik" : "uyari",
      title: `${card.name} limitinin ${formatPercent(ledger.utilizationRatio, 0)}'i dolu`,
      body:
        `Toplam borç: ${formatMoney(ledger.totalDebtMinor, card.currency)}\n` +
        `Limit: ${formatMoney(card.creditLimitMinor, card.currency)}\n` +
        `Kalan: ${formatMoney(ledger.availableLimitMinor, card.currency)}`,
      targetDate: ref,
      entityType: "kart",
      entityId: card.id,
    });
  }

  /* 5) Ek hesap (KMH) kullanımı */
  for (const account of snap.accounts) {
    if (!account.isActive) continue;
    const balance = snap.balances.get(account.id);
    if (!balance || balance.overdraftUsedMinor <= 0) continue;

    out.push({
      dedupeKey: `kmh-${account.id}-${ref}`,
      type: "ek_hesap_kullanimi",
      severity: balance.overdraftAvailableMinor <= 0 ? "kritik" : "uyari",
      title: `${account.name} ek hesapta`,
      body:
        `Kullanılan: ${formatMoney(balance.overdraftUsedMinor, account.currency)}\n` +
        `Kalan limit: ${formatMoney(balance.overdraftAvailableMinor, account.currency)}\n` +
        "Ek hesap faizi günlük işler, en kısa sürede kapatın.",
      targetDate: ref,
      entityType: "hesap",
      entityId: account.id,
    });
  }

  return out;
}

/* ─────────────────────────────── Günlük özet ─────────────────────────────── */

export function buildDailyDigest(snap: FinancialSnapshot): PendingNotification | null {
  const obligations = upcomingObligations(snap, { days: 7, includeOverdue: false });
  if (obligations.length === 0) return null;

  const total = obligations
    .filter((o) => !o.isIncome && o.affectsCash)
    .reduce((s, o) => s + o.amountMinor, 0);

  const lines = obligations
    .slice(0, 8)
    .map(
      (o) =>
        `${formatDateTR(o.date).padEnd(14)} ${o.isIncome ? "+" : "−"}${formatMoney(o.amountMinor)}  ${o.label}`,
    );

  const more =
    obligations.length > 8 ? `\n… ve ${obligations.length - 8} kalem daha` : "";

  return {
    dedupeKey: `gunluk-ozet-${snap.ref}`,
    type: "gunluk_ozet",
    severity: "bilgi",
    title: `Önümüzdeki 7 gün: ${formatMoney(total)} ödeme`,
    body: lines.join("\n") + more,
    targetDate: snap.ref,
    entityType: null,
    entityId: null,
  };
}

/* ────────────────────────────── Çalıştırma ──────────────────────────────── */

export interface NotifyRunResult {
  generated: number;
  sent: number;
  skipped: number;
  failures: string[];
}

/**
 * Kuralları çalıştırır, daha önce gönderilmemiş uyarıları kanallara iletir.
 * `dryRun` ile gönderim yapmadan sadece üretilenler görülebilir.
 */
export async function runNotifications(
  options: { dryRun?: boolean; includeDigest?: boolean; ref?: ISODate } = {},
): Promise<NotifyRunResult> {
  const snap = await loadSnapshot(options.ref ?? today());
  const pending = buildNotifications(snap);

  if (options.includeDigest && snap.settings.dailyDigestEnabled) {
    const digest = buildDailyDigest(snap);
    if (digest) pending.push(digest);
  }

  const result: NotifyRunResult = {
    generated: pending.length,
    sent: 0,
    skipped: 0,
    failures: [],
  };

  for (const item of pending) {
    const existing = await db.query.notifications.findFirst({
      where: eq(notifications.dedupeKey, item.dedupeKey),
    });

    if (existing?.sentAt) {
      result.skipped++;
      continue;
    }

    const row = existing
      ? existing
      : (
          await db
            .insert(notifications)
            .values({
              dedupeKey: item.dedupeKey,
              type: item.type,
              severity: item.severity,
              title: item.title,
              body: item.body,
              targetDate: item.targetDate,
              entityType: item.entityType,
              entityId: item.entityId,
            })
            .returning()
        )[0];

    if (options.dryRun) {
      result.sent++;
      continue;
    }

    const deliveries: DeliveryResult[] = await deliver(snap.settings, {
      title: item.title,
      body: item.body,
      severity: item.severity,
      url: process.env.APP_URL,
    });

    const succeeded = deliveries.filter((d) => d.ok).map((d) => d.channel);
    for (const failure of deliveries.filter((d) => !d.ok)) {
      result.failures.push(`${failure.channel}: ${failure.error}`);
    }

    // Hiç kanal yapılandırılmamışsa uyarı yine de kaydedilir; arayüzde görünür.
    await db
      .update(notifications)
      .set({
        sentAt: Date.now(),
        channels: succeeded.join(",") || (deliveries.length === 0 ? "yok" : "basarisiz"),
      })
      .where(eq(notifications.id, row.id));

    result.sent++;
  }

  return result;
}

function daysDiff(from: ISODate, to: ISODate): number {
  const a = new Date(`${from}T00:00:00Z`).getTime();
  const b = new Date(`${to}T00:00:00Z`).getTime();
  return Math.round((b - a) / 86_400_000);
}
