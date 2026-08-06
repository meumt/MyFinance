/**
 * Bildirim çalıştırıcısı — cron ya da docker-compose servisinden çağrılır.
 *
 *   npm run notify              → uyarıları üret ve gönder
 *   npm run notify -- --digest  → günlük özeti de gönder
 *   npm run notify -- --dry     → gönderim yapmadan dene
 */
import { runNotifications } from "../src/lib/notify/rules";
import { getSettings } from "../src/lib/settings";
import { syncTcmbRates } from "../src/lib/fx";

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry");
  const includeDigest = args.includes("--digest");

  const settings = await getSettings();

  if (settings.autoFetchRates && !dryRun) {
    const count = await syncTcmbRates();
    if (count > 0) console.log(`· ${count} döviz kuru güncellendi`);
  }

  const result = await runNotifications({ dryRun, includeDigest });

  console.log(
    `${dryRun ? "[deneme] " : ""}üretilen: ${result.generated}  gönderilen: ${result.sent}  atlanan: ${result.skipped}`,
  );

  for (const failure of result.failures) {
    console.error(`  ! ${failure}`);
  }

  process.exit(result.failures.length > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error("Bildirim çalıştırıcısı hata verdi:", error);
  process.exit(1);
});
