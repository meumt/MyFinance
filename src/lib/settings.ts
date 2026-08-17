import "server-only";

import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { settings } from "@/db/schema";
import { DEFAULT_MINIMUM_POLICY, type MinimumPaymentPolicy } from "./statements";

/**
 * Uygulama ayarları anahtar/değer olarak saklanır.
 * Bildirim kanalları ve mevzuata bağlı oranlar buradan yönetilir.
 */

export interface AppSettings {
  /** Uyarı kaç gün önceden gönderilsin. */
  dueReminderDays: number[];
  /** Kart doluluk oranı bu yüzdeyi aşınca uyar. */
  cardUtilizationWarnPercent: number;
  /** Ödeme günü hesapta bu tutardan az kalıyorsa uyar (kuruş). */
  lowBalanceThresholdMinor: number;
  minimumPolicy: MinimumPaymentPolicy;

  /** Kredi kartı aylık akdi faiz oranı (baz puan). Borç projeksiyonunda kullanılır. */
  cardMonthlyRateBps: number;
  /** Ek hesap için varsayılan yıllık faiz (hesaba özel oran girilmemişse). */
  overdraftDefaultAnnualRateBps: number;

  /**
   * Bilinen ödemeler dışında her ay giden tahmini tutar (market, ulaşım,
   * yemek…). İleriye dönük plan bu varsayım olmadan olduğundan iyimser çıkar.
   */
  livingCostMinor: number;

  /* ── Yatırım fiyatları ── */
  /** Fonoloji (TEFAS) API anahtarı. Boşsa fon fiyatları çekilmez. */
  fonolojiApiKey: string;
  /** Fiyat bu süreden eskiyse yenilenir. Kotayı korur. */
  quoteTtlMinutes: number;
  /** Panel/yatırım sayfası açıldığında bayat fiyatlar kendiliğinden yenilensin. */
  autoRefreshQuotes: boolean;

  ntfyEnabled: boolean;
  ntfyServer: string;
  ntfyTopic: string;
  ntfyToken: string;

  telegramEnabled: boolean;
  telegramBotToken: string;
  telegramChatId: string;

  emailEnabled: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  smtpPassword: string;
  emailFrom: string;
  emailTo: string;

  /** Günlük özet bildirimi saati (Europe/Istanbul, 0-23). */
  dailyDigestHour: number;
  dailyDigestEnabled: boolean;

  /** TCMB kurlarını otomatik çek. */
  autoFetchRates: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  dueReminderDays: [7, 3, 1, 0],
  cardUtilizationWarnPercent: 90,
  lowBalanceThresholdMinor: 0,
  minimumPolicy: DEFAULT_MINIMUM_POLICY,

  cardMonthlyRateBps: 425, // %4,25 / ay
  overdraftDefaultAnnualRateBps: 6000, // %60 / yıl
  livingCostMinor: 0,

  fonolojiApiKey: "",
  quoteTtlMinutes: 15,
  autoRefreshQuotes: true,

  ntfyEnabled: false,
  ntfyServer: "https://ntfy.sh",
  ntfyTopic: "",
  ntfyToken: "",

  telegramEnabled: false,
  telegramBotToken: "",
  telegramChatId: "",

  emailEnabled: false,
  smtpHost: "",
  smtpPort: 587,
  smtpSecure: false,
  smtpUser: "",
  smtpPassword: "",
  emailFrom: "",
  emailTo: "",

  dailyDigestHour: 9,
  dailyDigestEnabled: true,

  autoFetchRates: true,
};

const SETTINGS_KEY = "app";

export async function getSettings(): Promise<AppSettings> {
  const rows = await db
    .select()
    .from(settings)
    .where(inArray(settings.key, [SETTINGS_KEY]));

  if (rows.length === 0) return DEFAULT_SETTINGS;

  try {
    const stored = JSON.parse(rows[0].value) as Partial<AppSettings>;
    // Yeni ayar alanları eklendiğinde eski kayıtlar bozulmasın diye derin birleştirme.
    return {
      ...DEFAULT_SETTINGS,
      ...stored,
      minimumPolicy: {
        ...DEFAULT_SETTINGS.minimumPolicy,
        ...(stored.minimumPolicy ?? {}),
      },
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(patch: Partial<AppSettings>): Promise<void> {
  const current = await getSettings();
  const next: AppSettings = {
    ...current,
    ...patch,
    minimumPolicy: { ...current.minimumPolicy, ...(patch.minimumPolicy ?? {}) },
  };

  await db
    .insert(settings)
    .values({ key: SETTINGS_KEY, value: JSON.stringify(next) })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value: JSON.stringify(next), updatedAt: Date.now() },
    });
}

/**
 * Gizli alanları arayüze göndermeden önce maskeler.
 * Şifre/token değerleri ekrana asla ham gönderilmez.
 */
export function maskSecrets(s: AppSettings): AppSettings {
  const mask = (v: string) => (v ? "••••••••" : "");
  return {
    ...s,
    ntfyToken: mask(s.ntfyToken),
    telegramBotToken: mask(s.telegramBotToken),
    smtpPassword: mask(s.smtpPassword),
    fonolojiApiKey: mask(s.fonolojiApiKey),
  };
}

/** Maskeli değer geri gönderildiyse mevcut sırrı korur. */
export function unmaskPatch(
  patch: Partial<AppSettings>,
  current: AppSettings,
): Partial<AppSettings> {
  const out = { ...patch };
  const keys = [
    "ntfyToken",
    "telegramBotToken",
    "smtpPassword",
    "fonolojiApiKey",
  ] as const;
  for (const k of keys) {
    if (out[k] === "••••••••") out[k] = current[k];
  }
  return out;
}
