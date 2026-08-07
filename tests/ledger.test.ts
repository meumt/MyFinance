/**
 * Kart defteri testleri — `npm run test:ledger` ile çalışır.
 *
 * Buradaki senaryolar gerçek kullanımda karşılaşılan ve daha önce hataya yol
 * açmış durumları kilitler: fazla ödeme, devreden bakiye ve açık döneme düşen
 * taksitin iki kez sayılması.
 */
import type { Card, Installment, Transaction } from "../src/db/schema";
import type { RateMap } from "../src/lib/convert";
import { computeAccountBalance, computeCardLedger } from "../src/lib/ledger";

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

/* ────────────────────────── Yardımcı kurucular ────────────────────────── */

function makeCard(overrides: Partial<Card> = {}): Card {
  return {
    id: 1,
    institutionId: null,
    name: "Test Kart",
    type: "kredi",
    parentCardId: null,
    sharesParentLimit: true,
    lastFour: null,
    network: null,
    currency: "TRY",
    creditLimitMinor: 6_000_00,
    cashAdvanceLimitMinor: 0,
    statementDay: 15,
    dueDay: 25,
    linkedAccountId: null,
    autoPayMode: "yok",
    openingDebtMinor: 0,
    isActive: true,
    color: "#000",
    sortOrder: 0,
    notes: null,
    createdAt: Date.parse("2026-06-01T00:00:00Z"),
    ...overrides,
  };
}

let txId = 0;
function tx(overrides: Partial<Transaction>): Transaction {
  return {
    id: ++txId,
    date: "2026-08-01",
    kind: "gider",
    amountMinor: 0,
    currency: "TRY",
    fxRateMicro: null,
    accountId: null,
    cardId: null,
    counterAccountId: null,
    counterCardId: null,
    categoryId: null,
    merchantId: null,
    statementId: null,
    installmentPlanId: null,
    installmentNo: null,
    subscriptionId: null,
    loanPaymentId: null,
    description: null,
    note: null,
    tags: null,
    source: "manuel",
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

let instId = 0;
function inst(dueDate: string, amountMinor: number, isPaid = false): Installment {
  return {
    id: ++instId,
    planId: 1,
    seq: instId,
    amountMinor,
    dueDate,
    statementId: null,
    isPaid,
    transactionId: null,
  };
}

/* ───────────────────── Senaryo: 12 taksit + fazla ödeme ───────────────────── */
group("Kart defteri — devreden bakiye ve fazla ödeme");

const card = makeCard();
const REF = "2026-08-06";

// 2.000 TL'lik 12 taksit, her ayın 15'ine düşer (kesim günü).
const installments = Array.from({ length: 12 }, (_, i) => {
  const month = 5 + i;
  const year = 2026 + Math.floor((month - 1) / 12);
  const mm = ((month - 1) % 12) + 1;
  return inst(`${year}-${String(mm).padStart(2, "0")}-15`, 2_000_00, i < 3);
});

const transactions = [
  tx({ date: "2026-07-20", cardId: 1, amountMinor: 1_650_00 }),
  tx({ date: "2026-08-02", cardId: 1, amountMinor: 1_345_50 }),
  tx({ date: "2026-08-04", cardId: 1, amountMinor: 2_500_00 }),
  // Dönem borcu 6.000 iken 9.000 ödenmiş — 3.000 alacak oluşur.
  tx({ date: "2026-07-25", kind: "kart_odeme", counterCardId: 1, amountMinor: 9_000_00 }),
];

const ledger = computeCardLedger({
  card,
  transactions,
  installments,
  ref: REF,
});

const period = (key: string) => ledger.periods.find((p) => p.period.monthKey === key)!;

/* Ödemeler en eski borçtan başlayarak mahsup edilir: 9.000 TL sırayla
   Mayıs, Haziran ve Temmuz taksitlerini (3 × 2.000) kapatır, kalan 3.000
   alacak olarak sonraki döneme geçer. */
eq(period("2026-05").paymentsMinor, 2_000_00, "ödeme önce en eski ekstreye gider");
eq(period("2026-05").carryOutMinor, 0, "en eski dönem kapanır");
eq(period("2026-07").totalDueMinor, 2_000_00, "önceki dönemler kapandığı için devreden yok");
eq(period("2026-07").paymentsMinor, 2_000_00, "Temmuz taksiti de aynı ödemeden karşılanır");
eq(period("2026-07").carryOutMinor, 0, "Temmuz da kapanır");
eq(period("2026-08").paymentsMinor, 3_000_00, "artan ödeme sonraki döneme alacak olarak geçer");

eq(
  period("2026-08").chargesMinor,
  5_495_50,
  "kesim sonrası harcama sonraki döneme geçer (1.650 + 1.345,50 + 2.500)",
);
eq(period("2026-08").isCurrent, true, "kesilmemiş dönem açık dönemdir");

/* Daha önce hatalıydı: kalanı pozitif olan ESKİ dönem güncel borç sanılıyordu. */
eq(
  ledger.currentDueMinor,
  0,
  "fazla ödemeden sonra güncel dönem borcu sıfırdır (eski dönemin kalanı değil)",
);

/* Daha önce hatalıydı: açık döneme düşen taksit hem açık dönem harcamasında
   hem kalan taksitlerde sayılıyordu. */
eq(
  ledger.openPeriodSpendMinor,
  5_495_50,
  "açık dönem harcaması taksitleri içermez",
);
eq(
  ledger.remainingInstallmentsMinor,
  18_000_00,
  "kalan taksitler açık dönemdekiyle birlikte 9 × 2.000",
);
eq(
  ledger.totalDebtMinor,
  23_495_50,
  "toplam borç = güncel dönem 0 + açık dönem 5.495,50 + taksitler 18.000",
);

// Borç 23.495,50; limit 6.000 → aşım var, kalan limit eksiye düşmez.
eq(ledger.availableLimitMinor, 0, "limit aşıldığında kalan limit 0'a sabitlenir");
eq(ledger.utilizationRatio > 1, true, "limit aşımında doluluk oranı %100'ü geçer");

/* ─────────────────── Senaryo: normal ödenmemiş ekstre ─────────────────── */
group("Kart defteri — ödenmemiş ekstre");

const unpaidLedger = computeCardLedger({
  card: makeCard({ id: 2, creditLimitMinor: 50_000_00 }),
  transactions: [
    tx({ date: "2026-07-10", cardId: 2, amountMinor: 3_000_00 }),
    tx({ date: "2026-08-02", cardId: 2, amountMinor: 1_000_00 }),
  ],
  installments: [],
  ref: REF,
});

eq(unpaidLedger.currentDueMinor, 3_000_00, "ödeme yapılmadıysa kesilen ekstre borç olarak durur");
eq(unpaidLedger.openPeriodSpendMinor, 1_000_00, "açık dönemde biriken harcama ayrı gösterilir");
eq(unpaidLedger.totalDebtMinor, 4_000_00, "toplam borç ikisinin toplamı");
eq(unpaidLedger.nextDueDate, "2026-07-25", "ödenmemiş ekstrenin son ödeme tarihi");

/* ────────── Senaryo: devam eden taksitli alışveriş sonradan girilir ────────── */
group("Kart defteri — sisteme sonradan girilen taksitli alışveriş");

/**
 * Gerçek durum: kesim 10, son ödeme 20. 19 Haziran'da 3 taksitli alışveriş
 * yapılmış, ilk taksit 20 Temmuz'da ödenmiş. Kullanıcı sistemi 6 Ağustos'ta
 * kuruyor ve "3 taksit, 1'i ödendi" diyor.
 *
 * Beklenen: Temmuz ekstresi kapanmış ve ödenmiş sayılır — gecikmiş borç YOK.
 */
const gecKart = makeCard({ id: 4, statementDay: 10, dueDay: 20, creditLimitMinor: 50_000_00 });
const PLAN_GIRIS = "2026-08-06";

// 19 Haziran alışverişi 10 Haziran kesiminden sonra → ilk taksit Temmuz dönemine düşer.
const gecTaksitler = [
  inst("2026-07-10", 1_000_00, true), // sisteme girmeden önce ödenmiş
  inst("2026-08-10", 1_000_00, false),
  inst("2026-09-10", 1_000_00, false),
];
// Test yardımcısı tüm taksitleri planId 1 ile üretiyor.
for (const t of gecTaksitler) t.planId = 7;

const gecLedger = computeCardLedger({
  card: gecKart,
  transactions: [],
  installments: gecTaksitler,
  planEntryDates: new Map([[7, PLAN_GIRIS]]),
  ref: REF,
});

const gecPeriod = (key: string) =>
  gecLedger.periods.find((p) => p.period.monthKey === key)!;

eq(gecPeriod("2026-07").installmentsMinor, 0, "sisteme girmeden önce ödenen taksit ekstreye yazılmaz");
eq(gecPeriod("2026-07").totalDueMinor, 0, "Temmuz ekstresi kapalı — borç yok");
eq(gecPeriod("2026-07").status, "odendi", "gecikmiş değil, ödenmiş görünür");
eq(gecLedger.currentDueMinor, 0, "güncel dönem borcu yok");
eq(gecPeriod("2026-08").installmentsMinor, 1_000_00, "ödenmemiş Ağustos taksiti ekstreye yazılır");
eq(gecLedger.remainingInstallmentsMinor, 2_000_00, "kalan iki taksit borç olarak durur");

/* Aynı veri, plan giriş tarihi bilinmiyorsa: ödenmiş taksit yine sayılır
   (eski kayıtlarla geriye dönük uyumluluk). */
const gecLedgerNoEntry = computeCardLedger({
  card: gecKart,
  transactions: [],
  installments: gecTaksitler,
  ref: REF,
});
eq(
  gecLedgerNoEntry.periods.find((p) => p.period.monthKey === "2026-07")!.totalDueMinor,
  1_000_00,
  "giriş tarihi yoksa davranış değişmez",
);

/* ─────────── Senaryo: gecikmiş ekstre sonradan ödenir ─────────── */
group("Kart defteri — gecikmiş ekstrenin sonradan ödenmesi");

const gecikmisLedger = computeCardLedger({
  card: makeCard({ id: 5, statementDay: 10, dueDay: 20, creditLimitMinor: 50_000_00 }),
  transactions: [
    // 5 Temmuz harcaması → 10 Temmuz ekstresi, son ödeme 20 Temmuz (geçti).
    tx({ date: "2026-07-05", cardId: 5, amountMinor: 2_000_00 }),
    // Ödeme bugün yapılıyor, yani gecikmeli.
    tx({ date: "2026-08-06", kind: "kart_odeme", counterCardId: 5, amountMinor: 2_000_00 }),
  ],
  installments: [],
  ref: REF,
});

const gecikmisTemmuz = gecikmisLedger.periods.find((p) => p.period.monthKey === "2026-07")!;
eq(gecikmisTemmuz.paymentsMinor, 2_000_00, "bugün yapılan ödeme gecikmiş ekstreye mahsup edilir");
eq(gecikmisTemmuz.carryOutMinor, 0, "gecikmiş borç kapanır");
eq(gecikmisTemmuz.status, "odendi", "durum ödendi olur");
eq(gecikmisLedger.currentDueMinor, 0, "güncel borç kalmaz");

/* ───────────────────── Senaryo: devreden açılış borcu ───────────────────── */
group("Kart defteri — sisteme girişte devreden borç");

const openingLedger = computeCardLedger({
  card: makeCard({ id: 3, openingDebtMinor: 5_000_00 }),
  transactions: [],
  installments: [],
  ref: REF,
});

eq(openingLedger.currentDueMinor, 5_000_00, "devreden borç ilk dönemden itibaren taşınır");

/* ────────────── Senaryo: dövizli abonelik TL kartta ────────────── */
group("Kart defteri — döviz çevrimi");

/**
 * 14,59 USD'lik bir abonelik TL kartla ödeniyor. Kur çevrilmezse ekstreye
 * 14,59 TL yazılır — kırk kat hatalı.
 */
const usdRates: RateMap = new Map([
  ["TRY", 1_000_000],
  ["USD", 42_150_000], // 1 USD = 42,15 TL
]);

const dovizLedger = computeCardLedger({
  card: makeCard({ id: 6, statementDay: 15, dueDay: 25, creditLimitMinor: 50_000_00 }),
  transactions: [
    tx({ date: "2026-08-02", cardId: 6, amountMinor: 14_59, currency: "USD" }),
  ],
  installments: [],
  rates: usdRates,
  ref: REF,
});

eq(
  dovizLedger.openPeriodSpendMinor,
  Math.round((14_59 * 42_150_000) / 1_000_000),
  "14,59 USD kartın TL karşılığına çevrilir (≈615 TL)",
);
eq(dovizLedger.openPeriodSpendMinor, 614_97, "14,59 × 42,15 = 614,97 TL");
eq(dovizLedger.missingRates.count, 0, "kur bilindiği için eksik yok");

/* İşlem günü kuru hareketin üzerinde saklıysa güncel kur yerine o kullanılır. */
const sabitKurLedger = computeCardLedger({
  card: makeCard({ id: 7, statementDay: 15, dueDay: 25 }),
  transactions: [
    tx({
      date: "2026-08-02",
      cardId: 7,
      amountMinor: 14_59,
      currency: "USD",
      fxRateMicro: 30_000_000, // işlem günü 1 USD = 30 TL idi
    }),
  ],
  installments: [],
  rates: usdRates,
  ref: REF,
});
eq(
  sabitKurLedger.openPeriodSpendMinor,
  437_70,
  "geçmiş harcama bugünkü kurla değil, işlem günü kuruyla değerlenir",
);

/* Kur hiç bilinmiyorsa tutar borca katılmaz ve kullanıcıya bildirilir. */
const kursuzLedger = computeCardLedger({
  card: makeCard({ id: 8, statementDay: 15, dueDay: 25 }),
  transactions: [
    tx({ date: "2026-08-02", cardId: 8, amountMinor: 14_59, currency: "USD" }),
  ],
  installments: [],
  rates: new Map([["TRY", 1_000_000]]),
  ref: REF,
});
eq(kursuzLedger.openPeriodSpendMinor, 0, "kuru bilinmeyen tutar borca yazılmaz");
eq(kursuzLedger.missingRates, { currencies: ["USD"], count: 1 }, "eksik kur bildirilir");

/* ───────────────────────── Hesap bakiyesi ───────────────────────── */
group("Hesap bakiyesi");

const account = {
  id: 10,
  institutionId: null,
  name: "Vadesiz",
  type: "vadesiz",
  currency: "TRY",
  iban: null,
  openingBalanceMinor: 42_500_75,
  openingDate: "2026-07-01",
  overdraftLimitMinor: 50_000_00,
  overdraftRateBps: 5900,
  maturityDate: null,
  interestRateBps: 0,
  isActive: true,
  excludeFromNetWorth: false,
  color: "#000",
  sortOrder: 0,
  notes: null,
  createdAt: 0,
};

const accountTx = [
  tx({ date: "2026-07-05", kind: "gelir", accountId: 10, amountMinor: 85_000_00 }),
  tx({ date: "2026-07-06", kind: "gider", accountId: 10, amountMinor: 18_000_00 }),
  tx({ date: "2026-07-25", kind: "kart_odeme", accountId: 10, counterCardId: 1, amountMinor: 9_000_00 }),
  tx({ date: "2026-08-01", kind: "gelir", accountId: 10, amountMinor: 85_000_00 }),
  tx({ date: "2026-08-05", kind: "gider", accountId: 10, amountMinor: 18_000_00 }),
  // Açılış tarihinden ÖNCEKİ hareket sayılmamalı — açılış bakiyesine dahildir.
  tx({ date: "2026-06-20", kind: "gider", accountId: 10, amountMinor: 99_999_00 }),
];

const balance = computeAccountBalance(account, accountTx, null);
eq(balance.balanceMinor, 167_500_75, "bakiye = açılış + sonraki hareketler");
eq(balance.overdraftUsedMinor, 0, "pozitif bakiyede ek hesap kullanımı yok");
eq(balance.spendableMinor, 167_500_75 + 50_000_00, "harcanabilir = bakiye + ek hesap limiti");

/* Mutabakat tabanı: o tarihten sonraki hareketler işlenir. */
const reconciled = computeAccountBalance(account, accountTx, {
  date: "2026-08-01",
  balanceMinor: 100_000_00,
});
eq(
  reconciled.balanceMinor,
  100_000_00 - 18_000_00,
  "mutabakat sonrası yalnızca sonraki hareketler eklenir",
);

/* Eksi bakiye ek hesap kullanımıdır. */
const overdrawn = computeAccountBalance(
  { ...account, openingBalanceMinor: 0 },
  [tx({ date: "2026-07-10", kind: "gider", accountId: 10, amountMinor: 12_000_00 })],
  null,
);
eq(overdrawn.balanceMinor, -12_000_00, "eksi bakiye");
eq(overdrawn.overdraftUsedMinor, 12_000_00, "kullanılan ek hesap");
eq(overdrawn.overdraftAvailableMinor, 38_000_00, "kalan ek hesap limiti");

/* ────────────────────────────── Sonuç ────────────────────────────── */
console.log(
  failed === 0
    ? `\n✓ ${passed} testin tamamı geçti`
    : `\n✗ ${failed} test başarısız (${passed} geçti)`,
);
process.exit(failed === 0 ? 0 : 1);
