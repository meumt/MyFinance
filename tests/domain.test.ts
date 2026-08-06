/**
 * Alan mantığı testleri — `npm test` ile çalışır.
 * Harici test kütüphanesi yok; tsx üzerinde doğrudan koşar.
 */
import {
  buildPeriod,
  dueDateForStatement,
  minimumPaymentMinor,
  periodForTransaction,
  upcomingPeriods,
} from "../src/lib/statements";
import { formatMoney, parseMoneyToMinor, splitMinor } from "../src/lib/money";
import { addMonthsToKey, dateInMonth, monthRange } from "../src/lib/dates";

let failed = 0;
let passed = 0;

function eq(actual: unknown, expected: unknown, msg: string) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    passed++;
  } else {
    failed++;
    console.log(
      `FAIL  ${msg}\n      beklenen: ${JSON.stringify(expected)}\n      gelen   : ${JSON.stringify(actual)}`,
    );
  }
}

function group(name: string) {
  console.log(`\n── ${name}`);
}

/* ─────────────────── Kredi kartı dönem mantığı ─────────────────── */
group("Hesap kesim / son ödeme döngüsü");

const kesim15 = { statementDay: 15, dueDay: 25 };
eq(dueDateForStatement("2026-03-15", kesim15), "2026-03-25", "kesim 15 / ödeme 25 aynı ay");
eq(buildPeriod("2026-03", kesim15).periodStart, "2026-02-16", "dönem başı önceki kesimin ertesi günü");
eq(periodForTransaction("2026-03-15", kesim15).monthKey, "2026-03", "kesim günündeki harcama o ekstreye");
eq(periodForTransaction("2026-03-16", kesim15).monthKey, "2026-04", "kesim ertesi harcama sonraki ekstreye");

const kesim25 = { statementDay: 25, dueDay: 5 };
eq(dueDateForStatement("2026-03-25", kesim25), "2026-04-05", "ödeme günü kesimden küçük → ertesi ay");
eq(dueDateForStatement("2026-12-25", kesim25), "2027-01-05", "yıl sonunda taşma");

const kesim31 = { statementDay: 31, dueDay: 10 };
eq(buildPeriod("2026-02", kesim31).statementDate, "2026-02-28", "31'i olmayan ayda ay sonuna sabitlenir");
eq(buildPeriod("2028-02", kesim31).statementDate, "2028-02-29", "artık yılda 29 Şubat");
eq(buildPeriod("2026-03", kesim31).periodStart, "2026-03-01", "kısa ay sonrası dönem başı");

eq(
  upcomingPeriods(kesim25, 3, "2026-03-10").map((p) => p.monthKey),
  ["2026-03", "2026-04", "2026-05"],
  "gelecek dönemler kesintisiz sıralı",
);

/* ─────────────────────── Asgari ödeme ─────────────────────── */
group("Asgari ödeme tutarı");

eq(minimumPaymentMinor(10_000_00, 20_000_00), 2_000_00, "limit eşiğin altında → %20");
eq(minimumPaymentMinor(10_000_00, 50_000_00), 4_000_00, "limit eşiğin üstünde → %40");
eq(minimumPaymentMinor(100_00, 10_000_00, { isFirstYear: true }), 40_00, "ilk yıl kartı → %40");
eq(minimumPaymentMinor(0, 50_000_00), 0, "borç yoksa asgari de yok");

/* ──────────────────────── Taksit bölme ──────────────────────── */
group("Taksit bölme (küsurat korunumu)");

const uc = splitMinor(1000_00, 3);
eq(uc.reduce((a, b) => a + b, 0), 1000_00, "bölünen tutarların toplamı korunur");
eq(uc, [33334, 33333, 33333], "artan kuruş ilk taksite yazılır");
eq(splitMinor(999_99, 7).reduce((a, b) => a + b, 0), 999_99, "7 taksitte de toplam korunur");

/* ───────────────────── Türkçe para ayrıştırma ───────────────────── */
group("Para girdisi ayrıştırma");

eq(parseMoneyToMinor("1.234,56"), 123456, "1.234,56 (TR biçimi)");
eq(parseMoneyToMinor("1,234.56"), 123456, "1,234.56 (EN biçimi)");
eq(parseMoneyToMinor("2.500"), 250000, "2.500 binlik ayraç");
eq(parseMoneyToMinor("12.500"), 1250000, "12.500 binlik ayraç");
eq(parseMoneyToMinor("1.234.567"), 123456700, "çoklu binlik ayraç");
eq(parseMoneyToMinor("0.500"), 50, "0.500 binlik olamaz → ondalık");
eq(parseMoneyToMinor("2,50"), 250, "2,50 ondalık");
eq(parseMoneyToMinor("2.50"), 250, "2.50 iki haneli ondalık");
eq(parseMoneyToMinor("1.899,90 ₺"), 189990, "para simgeli girdi");
eq(parseMoneyToMinor("-45,90"), -4590, "negatif");
eq(parseMoneyToMinor("(45,90)"), -4590, "parantezli negatif");
eq(parseMoneyToMinor("abc"), null, "geçersiz girdi");
eq(parseMoneyToMinor(""), null, "boş girdi");
eq(formatMoney(189990), "1.899,90 ₺", "TL biçimlendirme");

/* ──────────────────────── Tarih yardımcıları ──────────────────────── */
group("Tarih yardımcıları");

eq(dateInMonth("2026-02", 31), "2026-02-28", "ay sonuna sabitleme");
eq(addMonthsToKey("2026-11", 3), "2027-02", "ay anahtarı yıl atlar");
eq(monthRange("2026-01", "2026-04"), ["2026-01", "2026-02", "2026-03", "2026-04"], "ay aralığı");

/* ────────────────────────────── Sonuç ────────────────────────────── */
console.log(
  failed === 0
    ? `\n✓ ${passed} testin tamamı geçti`
    : `\n✗ ${failed} test başarısız (${passed} geçti)`,
);
process.exit(failed === 0 ? 0 : 1);
