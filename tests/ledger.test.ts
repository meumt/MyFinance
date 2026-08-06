/**
 * Kart defteri testleri — `npm run test:ledger` ile çalışır.
 *
 * Buradaki senaryolar gerçek kullanımda karşılaşılan ve daha önce hataya yol
 * açmış durumları kilitler: fazla ödeme, devreden bakiye ve açık döneme düşen
 * taksitin iki kez sayılması.
 */
import type { Card, Installment, Transaction } from "../src/db/schema";
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

eq(period("2026-07").totalDueMinor, 6_000_00, "Temmuz dönem borcu = devreden 4.000 + taksit 2.000");
eq(period("2026-07").paymentsMinor, 9_000_00, "ödeme son ödeme gününe göre Temmuz ekstresine yazılır");
eq(period("2026-07").carryOutMinor, -3_000_00, "fazla ödeme alacağa dönüşür");

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

/* ───────────────────── Senaryo: devreden açılış borcu ───────────────────── */
group("Kart defteri — sisteme girişte devreden borç");

const openingLedger = computeCardLedger({
  card: makeCard({ id: 3, openingDebtMinor: 5_000_00 }),
  transactions: [],
  installments: [],
  ref: REF,
});

eq(openingLedger.currentDueMinor, 5_000_00, "devreden borç ilk dönemden itibaren taşınır");

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
