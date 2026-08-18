"use server";

import { requireUser } from "@/lib/auth";
import { setManualRate, syncTcmbRates } from "@/lib/fx";
import { MICRO } from "@/lib/fx";
import { sendTestNotification } from "@/lib/notify/channels";
import { runNotifications } from "@/lib/notify/rules";
import { getSettings, saveSettings, unmaskPatch } from "@/lib/settings";
import {
  bool,
  date,
  money,
  num,
  optionalNum,
  revalidateAll,
  str,
  toActionError,
  type ActionState,
} from "./_helpers";

export async function saveSettingsAction(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    await requireUser();
    const current = await getSettings();

    const reminderRaw = str(form, "dueReminderDays");
    const dueReminderDays = reminderRaw
      ? [
          ...new Set(
            reminderRaw
              .split(/[,\s]+/)
              .map((v) => Number(v))
              .filter((n) => Number.isInteger(n) && n >= 0 && n <= 30),
          ),
        ].sort((a, b) => b - a)
      : current.dueReminderDays;

    const patch = unmaskPatch(
      {
        dueReminderDays,
        cardUtilizationWarnPercent: Math.min(
          100,
          Math.max(10, Math.round(num(form, "cardUtilizationWarnPercent", 90))),
        ),
        lowBalanceThresholdMinor: money(form, "lowBalanceThreshold") ?? 0,
        livingCostMinor: money(form, "livingCost") ?? current.livingCostMinor,
        fonolojiApiKey: str(form, "fonolojiApiKey"),
        quoteTtlMinutes: Math.min(
          1440,
          Math.max(1, Math.round(num(form, "quoteTtlMinutes", 15))),
        ),
        autoRefreshQuotes: bool(form, "autoRefreshQuotes"),
        useExtendedHours: bool(form, "useExtendedHours"),
        cardMonthlyRateBps: Math.round((optionalNum(form, "cardMonthlyRate") ?? 4.25) * 100),
        overdraftDefaultAnnualRateBps: Math.round(
          (optionalNum(form, "overdraftDefaultAnnualRate") ?? 60) * 100,
        ),
        minimumPolicy: {
          limitThresholdMinor:
            money(form, "minimumLimitThreshold") ??
            current.minimumPolicy.limitThresholdMinor,
          lowRateBps: Math.round((optionalNum(form, "minimumLowRate") ?? 20) * 100),
          highRateBps: Math.round((optionalNum(form, "minimumHighRate") ?? 40) * 100),
          firstYearRateBps: Math.round(
            (optionalNum(form, "minimumFirstYearRate") ?? 40) * 100,
          ),
        },

        ntfyEnabled: bool(form, "ntfyEnabled"),
        ntfyServer: str(form, "ntfyServer") || "https://ntfy.sh",
        ntfyTopic: str(form, "ntfyTopic"),
        ntfyToken: str(form, "ntfyToken"),

        telegramEnabled: bool(form, "telegramEnabled"),
        telegramBotToken: str(form, "telegramBotToken"),
        telegramChatId: str(form, "telegramChatId"),

        emailEnabled: bool(form, "emailEnabled"),
        smtpHost: str(form, "smtpHost"),
        smtpPort: Math.round(num(form, "smtpPort", 587)),
        smtpSecure: bool(form, "smtpSecure"),
        smtpUser: str(form, "smtpUser"),
        smtpPassword: str(form, "smtpPassword"),
        emailFrom: str(form, "emailFrom"),
        emailTo: str(form, "emailTo"),

        dailyDigestEnabled: bool(form, "dailyDigestEnabled"),
        dailyDigestHour: Math.min(23, Math.max(0, Math.round(num(form, "dailyDigestHour", 9)))),
        autoFetchRates: bool(form, "autoFetchRates"),
      },
      current,
    );

    await saveSettings(patch);
    revalidateAll();
    return { success: "Ayarlar kaydedildi." };
  } catch (error) {
    return toActionError(error, "Ayarlar kaydedilemedi.");
  }
}

/**
 * Aylık yaşam gideri varsayımını tek başına kaydeder.
 * Plan ekranından girilebilsin diye ayrı bir eylem: kullanıcı ayarlar
 * sayfasına gitmeden tahminini düzeltip planın nasıl değiştiğini görür.
 */
export async function saveLivingCostAction(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    await requireUser();
    const value = money(form, "livingCost");
    if (value == null || value < 0) {
      return { error: "Geçerli bir tutar girin." };
    }
    await saveSettings({ livingCostMinor: value });
    revalidateAll();
    return { success: "Aylık yaşam gideri kaydedildi." };
  } catch (error) {
    return toActionError(error, "Kaydedilemedi.");
  }
}

export async function testNotificationAction(
  _prev: ActionState,
  _form: FormData,
): Promise<ActionState> {
  try {
    await requireUser();
    const settings = await getSettings();
    const results = await sendTestNotification(settings);

    if (results.length === 0) {
      return { error: "Etkin bildirim kanalı yok. Önce bir kanal açıp kaydedin." };
    }

    const ok = results.filter((r) => r.ok).map((r) => r.channel);
    const failed = results.filter((r) => !r.ok);

    if (failed.length === 0) {
      return { success: `Test gönderildi: ${ok.join(", ")}` };
    }
    return {
      error: failed.map((f) => `${f.channel}: ${f.error}`).join(" · "),
      success: ok.length > 0 ? `Başarılı: ${ok.join(", ")}` : undefined,
    };
  } catch (error) {
    return toActionError(error, "Test bildirimi gönderilemedi.");
  }
}

export async function runNotificationsAction(
  _prev: ActionState,
  _form: FormData,
): Promise<ActionState> {
  try {
    await requireUser();
    const result = await runNotifications({ includeDigest: false });
    revalidateAll();

    if (result.failures.length > 0) {
      return {
        error: `Bazı gönderimler başarısız: ${result.failures.slice(0, 2).join(" · ")}`,
        success: `${result.sent} uyarı işlendi.`,
      };
    }
    return {
      success:
        result.sent > 0
          ? `${result.sent} uyarı gönderildi (${result.skipped} zaten gönderilmişti).`
          : "Gönderilecek yeni uyarı yok.",
    };
  } catch (error) {
    return toActionError(error, "Uyarılar çalıştırılamadı.");
  }
}

/* ────────────────────────────── Döviz kurları ────────────────────────────── */

export async function syncRatesAction(
  _prev: ActionState,
  _form: FormData,
): Promise<ActionState> {
  try {
    await requireUser();
    const count = await syncTcmbRates();
    revalidateAll();
    return count > 0
      ? { success: `${count} kur TCMB'den güncellendi.` }
      : { error: "TCMB kurlarına ulaşılamadı. Elle giriş yapabilirsiniz." };
  } catch (error) {
    return toActionError(error, "Kurlar güncellenemedi.");
  }
}

export async function saveRateAction(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    await requireUser();
    const code = str(form, "code").toUpperCase();
    if (!code) return { error: "Para birimi seçin." };

    const value = optionalNum(form, "rate");
    if (value == null || value <= 0) return { error: "Geçerli bir kur girin." };

    await setManualRate(code, date(form, "date"), Math.round(value * MICRO));
    revalidateAll();
    return { success: `${code} kuru kaydedildi.` };
  } catch (error) {
    return toActionError(error, "Kur kaydedilemedi.");
  }
}
