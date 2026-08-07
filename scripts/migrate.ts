/**
 * Veritabanı şemasını uygular. Her konteyner açılışta bunu çalıştırır;
 * uygulanmış migration'lar atlandığı için tekrar tekrar koşması güvenlidir.
 *
 * Sunucu yeniden başladığında Docker, `depends_on` sırasını dikkate almadan
 * tüm konteynerleri aynı anda kaldırır. Bu yüzden iki süreç aynı anda
 * migration çalıştırmayı deneyebilir. SQLite'ın kendi kilidi yazmayı tek
 * sürece verir; burada beklemeyi ve yeniden denemeyi ekliyoruz ki ikinci
 * süreç hata verip konteyneri döngüye sokmasın.
 */
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import fs from "node:fs";
import path from "node:path";

const dbPath = process.env.DATABASE_PATH ?? "./data/myfinance.db";
const MAX_ATTEMPTS = 5;
const RETRY_DELAY_MS = 2000;

function isLockError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /SQLITE_BUSY|database is locked|database table is locked/i.test(message);
}

function sleepSync(ms: number): void {
  // Migration tek seferlik ve kısa bir işlem; senkron beklemek yeterli.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Taksitlerin işlem tarihi (posted_date) sonradan eklendi. Eski kayıtlarda
 * boş; planın alışveriş gününden türetilerek doldurulur — banka taksiti
 * alışveriş gününün her ayki karşılığında işler.
 */
function backfillPostedDates(sqlite: Database.Database): void {
  const rows = sqlite
    .prepare(
      `SELECT i.id, i.seq, p.purchase_date
         FROM installments i
         JOIN installment_plans p ON p.id = i.plan_id
        WHERE i.posted_date IS NULL`,
    )
    .all() as Array<{ id: number; seq: number; purchase_date: string }>;

  if (rows.length === 0) return;

  const update = sqlite.prepare("UPDATE installments SET posted_date = ? WHERE id = ?");
  const apply = sqlite.transaction(() => {
    for (const row of rows) {
      update.run(shiftMonths(row.purchase_date, row.seq - 1), row.id);
    }
  });
  apply();
  console.log(`· ${rows.length} taksitin işlem tarihi dolduruldu`);
}

/** Ayın gününü koruyarak ay ekler; kısa aylarda ay sonuna sabitler. */
function shiftMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const total = y * 12 + (m - 1) + months;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const day = Math.min(d, lastDay);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function runMigrations(): void {
  const sqlite = new Database(dbPath);
  try {
    // Kilit bekleme süresi: başka bir süreç yazıyorsa hata vermek yerine bekle.
    sqlite.pragma("busy_timeout = 15000");
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("foreign_keys = ON");

    migrate(drizzle(sqlite), { migrationsFolder: "./drizzle" });
    backfillPostedDates(sqlite);
  } finally {
    sqlite.close();
  }
}

const dir = path.dirname(dbPath);
if (dir && dir !== "." && !fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}

let lastError: unknown = null;

for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
  try {
    runMigrations();
    console.log(`✓ Şema güncel: ${dbPath}`);
    process.exit(0);
  } catch (error) {
    lastError = error;
    if (!isLockError(error) || attempt === MAX_ATTEMPTS) break;

    console.log(
      `· Veritabanı meşgul (deneme ${attempt}/${MAX_ATTEMPTS}), ${RETRY_DELAY_MS / 1000} sn sonra tekrar denenecek`,
    );
    sleepSync(RETRY_DELAY_MS);
  }
}

console.error("Şema uygulanamadı:", lastError);
process.exit(1);
