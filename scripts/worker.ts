/**
 * Arka plan zamanlayıcı. Docker Compose'da ayrı bir servis olarak çalışır ve
 * harici cron kurmadan bildirimleri düzenli olarak üretir.
 *
 * Her saat başı:
 *   - uyarı kuralları çalıştırılır (son ödeme, abonelik, limit, ek hesap)
 *   - ayarlarda belirlenen saatte günlük özet gönderilir
 */
import { runNotifications } from "../src/lib/notify/rules";
import { syncTcmbRates } from "../src/lib/fx";
import { getSettings } from "../src/lib/settings";
import { TIMEZONE } from "../src/lib/dates";

const CHECK_INTERVAL_MS = 15 * 60 * 1000; // 15 dakika

function istanbulHour(): number {
  return Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: TIMEZONE,
      hour: "2-digit",
      hour12: false,
    }).format(new Date()),
  );
}

function stamp(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

let lastDigestDate = "";
let lastRateSyncDate = "";

async function tick() {
  try {
    const settings = await getSettings();
    const hour = istanbulHour();
    const dateKey = new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE }).format(
      new Date(),
    );

    /* Kurlar günde bir kez, sabah 09'dan sonra çekilir. */
    if (settings.autoFetchRates && hour >= 9 && lastRateSyncDate !== dateKey) {
      const count = await syncTcmbRates();
      lastRateSyncDate = dateKey;
      if (count > 0) console.log(`[${stamp()}] ${count} kur güncellendi`);
    }

    /* Günlük özet, ayarlanan saatte günde bir kez. */
    const wantDigest =
      settings.dailyDigestEnabled &&
      hour === settings.dailyDigestHour &&
      lastDigestDate !== dateKey;

    const result = await runNotifications({ includeDigest: wantDigest });
    if (wantDigest) lastDigestDate = dateKey;

    if (result.sent > 0 || result.failures.length > 0) {
      console.log(
        `[${stamp()}] gönderilen: ${result.sent}  atlanan: ${result.skipped}` +
          (result.failures.length ? `  hata: ${result.failures.join(" · ")}` : ""),
      );
    }
  } catch (error) {
    console.error(`[${stamp()}] worker hatası:`, error);
  }
}

console.log(`[${stamp()}] MyFinance worker başladı (${TIMEZONE}, 15 dk aralık)`);
void tick();
setInterval(() => void tick(), CHECK_INTERVAL_MS);
