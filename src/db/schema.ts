import { sql } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

/**
 * Para birimleri kuruş (minor unit) cinsinden INTEGER olarak saklanır.
 * Kayan noktalı sayı finansal veride yuvarlama hatası ürettiği için asla kullanılmaz.
 * Tarihler: takvim tarihi TEXT 'YYYY-MM-DD', zaman damgası INTEGER (unix ms).
 */

const now = sql`(unixepoch() * 1000)`;

/* ─────────────────────────── Kullanıcı & Ayarlar ─────────────────────────── */

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  displayName: text("display_name"),
  // Şifre değişince tüm oturumları düşürmek için token'a gömülür.
  sessionEpoch: integer("session_epoch").notNull().default(1),
  createdAt: integer("created_at").notNull().default(now),
});

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at").notNull().default(now),
});

/* ──────────────────────────── Kurumlar & Hesaplar ─────────────────────────── */

export const institutions = sqliteTable("institutions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  shortName: text("short_name"),
  color: text("color").notNull().default("#64748b"),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
});

/** vadesiz | birikim | vadeli | nakit | yatirim */
export const accounts = sqliteTable(
  "accounts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    institutionId: integer("institution_id").references(() => institutions.id, {
      onDelete: "set null",
    }),
    name: text("name").notNull(),
    type: text("type").notNull().default("vadesiz"),
    currency: text("currency").notNull().default("TRY"),
    iban: text("iban"),
    /** Sisteme giriş anındaki bakiye; güncel bakiye = açılış + sonraki hareketler. */
    openingBalanceMinor: integer("opening_balance_minor").notNull().default(0),
    openingDate: text("opening_date").notNull(),

    /* Ek hesap (KMH) — hesabın eksiye düşebileceği limit */
    overdraftLimitMinor: integer("overdraft_limit_minor").notNull().default(0),
    /** Yıllık akdi faiz oranı, baz puan (100 bps = %1) */
    overdraftRateBps: integer("overdraft_rate_bps").notNull().default(0),

    /** Vadeli hesap için vade bitişi ve faiz oranı */
    maturityDate: text("maturity_date"),
    interestRateBps: integer("interest_rate_bps").notNull().default(0),

    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    excludeFromNetWorth: integer("exclude_from_net_worth", { mode: "boolean" })
      .notNull()
      .default(false),
    color: text("color").notNull().default("#0ea5e9"),
    sortOrder: integer("sort_order").notNull().default(0),
    notes: text("notes"),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [index("accounts_institution_idx").on(t.institutionId)],
);

/** Bakiye mutabakatı: "bugün hesapta şu kadar var" düzeltmesi */
export const balanceSnapshots = sqliteTable(
  "balance_snapshots",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    accountId: integer("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    balanceMinor: integer("balance_minor").notNull(),
    note: text("note"),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [index("balance_snapshots_account_idx").on(t.accountId, t.date)],
);

/* ──────────────────────────────── Kartlar ─────────────────────────────────── */

/** kredi | banka | sanal | onodemeli */
export const cards = sqliteTable(
  "cards",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    institutionId: integer("institution_id").references(() => institutions.id, {
      onDelete: "set null",
    }),
    name: text("name").notNull(),
    type: text("type").notNull().default("kredi"),
    /** Sanal kart bir fiziksel karta bağlıdır. */
    parentCardId: integer("parent_card_id"),
    /** Sanal kart ana kartın limitini paylaşıyorsa true; kendi alt limiti varsa false. */
    sharesParentLimit: integer("shares_parent_limit", { mode: "boolean" })
      .notNull()
      .default(true),
    lastFour: text("last_four"),
    network: text("network"),
    currency: text("currency").notNull().default("TRY"),

    creditLimitMinor: integer("credit_limit_minor").notNull().default(0),
    cashAdvanceLimitMinor: integer("cash_advance_limit_minor")
      .notNull()
      .default(0),

    /** Hesap kesim günü (1-31; 31 = ay sonu). */
    statementDay: integer("statement_day"),
    /** Son ödeme günü (1-31). Kesim gününden küçükse ertesi aya taşar. */
    dueDay: integer("due_day"),

    /** Banka kartı bu hesaba bağlıdır / kredi kartı buradan otomatik ödenir. */
    linkedAccountId: integer("linked_account_id").references(() => accounts.id, {
      onDelete: "set null",
    }),
    /** yok | asgari | tamami */
    autoPayMode: text("auto_pay_mode").notNull().default("yok"),

    /** Sisteme giriş anındaki devreden borç (henüz ödenmemiş dönem borcu). */
    openingDebtMinor: integer("opening_debt_minor").notNull().default(0),

    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    color: text("color").notNull().default("#8b5cf6"),
    sortOrder: integer("sort_order").notNull().default(0),
    notes: text("notes"),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [
    index("cards_institution_idx").on(t.institutionId),
    index("cards_parent_idx").on(t.parentCardId),
  ],
);

/** Ekstre dönemleri. acik | kapali | odendi | kismi | gecikmis */
export const statements = sqliteTable(
  "statements",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    cardId: integer("card_id")
      .notNull()
      .references(() => cards.id, { onDelete: "cascade" }),
    periodStart: text("period_start").notNull(),
    periodEnd: text("period_end").notNull(),
    statementDate: text("statement_date").notNull(),
    dueDate: text("due_date").notNull(),
    previousBalanceMinor: integer("previous_balance_minor")
      .notNull()
      .default(0),
    totalDueMinor: integer("total_due_minor").notNull().default(0),
    minimumDueMinor: integer("minimum_due_minor").notNull().default(0),
    paidMinor: integer("paid_minor").notNull().default(0),
    status: text("status").notNull().default("acik"),
    currency: text("currency").notNull().default("TRY"),
    notes: text("notes"),
  },
  (t) => [
    uniqueIndex("statements_card_period_idx").on(t.cardId, t.periodEnd),
    index("statements_due_idx").on(t.dueDate),
  ],
);

/* ─────────────────────────── Kategori & İşyeri ────────────────────────────── */

/** gider | gelir | transfer */
export const categories = sqliteTable(
  "categories",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    parentId: integer("parent_id"),
    kind: text("kind").notNull().default("gider"),
    icon: text("icon"),
    color: text("color").notNull().default("#94a3b8"),
    /** Zorunlu gider mi? "Kaç ayda toparlarım" senaryosunda kısılabilir gideri ayırır. */
    isEssential: integer("is_essential", { mode: "boolean" })
      .notNull()
      .default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  },
  (t) => [index("categories_parent_idx").on(t.parentId)],
);

/** Hızlı girişte "migros" yazınca kategoriyi otomatik bulmak için öğrenen tablo. */
export const merchants = sqliteTable(
  "merchants",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    /** Küçük harfe indirgenmiş, Türkçe karakterleri sadeleştirilmiş eşleşme anahtarı. */
    normalized: text("normalized").notNull().unique(),
    defaultCategoryId: integer("default_category_id").references(
      () => categories.id,
      { onDelete: "set null" },
    ),
    usageCount: integer("usage_count").notNull().default(0),
    lastUsedAt: integer("last_used_at"),
  },
  (t) => [index("merchants_usage_idx").on(t.usageCount)],
);

/* ─────────────────────────────── Hareketler ───────────────────────────────── */

/**
 * kind: gider | gelir | transfer | kart_odeme | faiz | ucret | iade | duzeltme
 * amountMinor her zaman pozitif; yön `kind` ile belirlenir.
 */
export const transactions = sqliteTable(
  "transactions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    date: text("date").notNull(),
    kind: text("kind").notNull().default("gider"),
    amountMinor: integer("amount_minor").notNull(),
    currency: text("currency").notNull().default("TRY"),
    /** İşlem anındaki TL kuru (mikro birim: kur * 1e6). Dövizli işlemlerde dolar. */
    fxRateMicro: integer("fx_rate_micro"),

    accountId: integer("account_id").references(() => accounts.id, {
      onDelete: "cascade",
    }),
    cardId: integer("card_id").references(() => cards.id, {
      onDelete: "cascade",
    }),
    /** Transferde karşı hesap. */
    counterAccountId: integer("counter_account_id").references(
      () => accounts.id,
      { onDelete: "set null" },
    ),
    /** Kart ödemesinde ödenen kart. */
    counterCardId: integer("counter_card_id").references(() => cards.id, {
      onDelete: "set null",
    }),

    categoryId: integer("category_id").references(() => categories.id, {
      onDelete: "set null",
    }),
    merchantId: integer("merchant_id").references(() => merchants.id, {
      onDelete: "set null",
    }),
    statementId: integer("statement_id").references(() => statements.id, {
      onDelete: "set null",
    }),

    installmentPlanId: integer("installment_plan_id"),
    installmentNo: integer("installment_no"),
    subscriptionId: integer("subscription_id"),
    loanPaymentId: integer("loan_payment_id"),

    description: text("description"),
    note: text("note"),
    tags: text("tags"),
    /** manuel | toplu | otomatik | tekrarlayan */
    source: text("source").notNull().default("manuel"),
    createdAt: integer("created_at").notNull().default(now),
    updatedAt: integer("updated_at").notNull().default(now),
  },
  (t) => [
    index("tx_date_idx").on(t.date),
    index("tx_account_idx").on(t.accountId, t.date),
    index("tx_card_idx").on(t.cardId, t.date),
    index("tx_category_idx").on(t.categoryId, t.date),
    index("tx_plan_idx").on(t.installmentPlanId),
  ],
);

/* ──────────────────────────── Taksitli Alışveriş ──────────────────────────── */

/** aktif | tamamlandi | iptal */
export const installmentPlans = sqliteTable(
  "installment_plans",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    cardId: integer("card_id")
      .notNull()
      .references(() => cards.id, { onDelete: "cascade" }),
    merchantId: integer("merchant_id").references(() => merchants.id, {
      onDelete: "set null",
    }),
    categoryId: integer("category_id").references(() => categories.id, {
      onDelete: "set null",
    }),
    description: text("description").notNull(),
    purchaseDate: text("purchase_date").notNull(),
    totalAmountMinor: integer("total_amount_minor").notNull(),
    currency: text("currency").notNull().default("TRY"),
    installmentCount: integer("installment_count").notNull(),
    /** Halihazırda ödenmiş taksit sayısı (devreden planları girerken kullanılır). */
    paidCount: integer("paid_count").notNull().default(0),
    firstDueDate: text("first_due_date").notNull(),
    status: text("status").notNull().default("aktif"),
    notes: text("notes"),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [index("plans_card_idx").on(t.cardId, t.status)],
);

/** Her taksit ayrı satır — gelecek ayların taksit yükü buradan hesaplanır. */
export const installments = sqliteTable(
  "installments",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    planId: integer("plan_id")
      .notNull()
      .references(() => installmentPlans.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    amountMinor: integer("amount_minor").notNull(),
    /**
     * Taksitin karta işlendiği gün — alışveriş gününün her ayki karşılığı.
     * Banka 23'ünde alınan bir alışverişin taksitlerini her ayın 23'ünde işler.
     * Kaynak gerçek budur; hangi ekstreye düştüğü bundan türetilir.
     */
    postedDate: text("posted_date"),
    /** Taksitin düştüğü ekstrenin kesim tarihi (postedDate'ten türetilir). */
    dueDate: text("due_date").notNull(),
    statementId: integer("statement_id").references(() => statements.id, {
      onDelete: "set null",
    }),
    isPaid: integer("is_paid", { mode: "boolean" }).notNull().default(false),
    transactionId: integer("transaction_id").references(() => transactions.id, {
      onDelete: "set null",
    }),
  },
  (t) => [
    uniqueIndex("installments_plan_seq_idx").on(t.planId, t.seq),
    index("installments_due_idx").on(t.dueDate, t.isPaid),
  ],
);

/* ───────────────────────────────── Abonelik ───────────────────────────────── */

/** haftalik | aylik | uc_aylik | alti_aylik | yillik | ozel */
export const subscriptions = sqliteTable(
  "subscriptions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    merchantId: integer("merchant_id").references(() => merchants.id, {
      onDelete: "set null",
    }),
    categoryId: integer("category_id").references(() => categories.id, {
      onDelete: "set null",
    }),
    amountMinor: integer("amount_minor").notNull(),
    currency: text("currency").notNull().default("TRY"),
    cycle: text("cycle").notNull().default("aylik"),
    /** cycle = 'ozel' ise gün cinsinden periyot. */
    cycleDays: integer("cycle_days"),
    startDate: text("start_date").notNull(),
    nextRenewalDate: text("next_renewal_date").notNull(),
    endDate: text("end_date"),
    lastChargedDate: text("last_charged_date"),

    paymentCardId: integer("payment_card_id").references(() => cards.id, {
      onDelete: "set null",
    }),
    paymentAccountId: integer("payment_account_id").references(
      () => accounts.id,
      { onDelete: "set null" },
    ),

    autoRenew: integer("auto_renew", { mode: "boolean" })
      .notNull()
      .default(true),
    reminderDaysBefore: integer("reminder_days_before").notNull().default(2),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    notes: text("notes"),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [index("subs_next_idx").on(t.nextRenewalDate, t.isActive)],
);

/* ──────────────────────── Krediler (ihtiyaç/taşıt/konut) ──────────────────── */

export const loans = sqliteTable("loans", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  institutionId: integer("institution_id").references(() => institutions.id, {
    onDelete: "set null",
  }),
  name: text("name").notNull(),
  /** ihtiyac | tasit | konut | diger */
  type: text("type").notNull().default("ihtiyac"),
  principalMinor: integer("principal_minor").notNull(),
  currency: text("currency").notNull().default("TRY"),
  annualRateBps: integer("annual_rate_bps").notNull().default(0),
  installmentCount: integer("installment_count").notNull(),
  monthlyPaymentMinor: integer("monthly_payment_minor").notNull(),
  firstPaymentDate: text("first_payment_date").notNull(),
  paymentAccountId: integer("payment_account_id").references(() => accounts.id, {
    onDelete: "set null",
  }),
  status: text("status").notNull().default("aktif"),
  notes: text("notes"),
  createdAt: integer("created_at").notNull().default(now),
});

export const loanPayments = sqliteTable(
  "loan_payments",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    loanId: integer("loan_id")
      .notNull()
      .references(() => loans.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    dueDate: text("due_date").notNull(),
    amountMinor: integer("amount_minor").notNull(),
    principalMinor: integer("principal_minor").notNull().default(0),
    interestMinor: integer("interest_minor").notNull().default(0),
    isPaid: integer("is_paid", { mode: "boolean" }).notNull().default(false),
    transactionId: integer("transaction_id").references(() => transactions.id, {
      onDelete: "set null",
    }),
  },
  (t) => [
    uniqueIndex("loan_payments_seq_idx").on(t.loanId, t.seq),
    index("loan_payments_due_idx").on(t.dueDate, t.isPaid),
  ],
);

/* ──────────────── Düzenli gelir/gider (maaş, kira, fatura) ────────────────── */

export const recurringItems = sqliteTable(
  "recurring_items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    /** gelir | gider */
    kind: text("kind").notNull().default("gelir"),
    amountMinor: integer("amount_minor").notNull(),
    currency: text("currency").notNull().default("TRY"),
    /** aylik | haftalik | yillik */
    cycle: text("cycle").notNull().default("aylik"),
    dayOfMonth: integer("day_of_month").notNull().default(1),
    accountId: integer("account_id").references(() => accounts.id, {
      onDelete: "set null",
    }),
    cardId: integer("card_id").references(() => cards.id, {
      onDelete: "set null",
    }),
    categoryId: integer("category_id").references(() => categories.id, {
      onDelete: "set null",
    }),
    startDate: text("start_date").notNull(),
    endDate: text("end_date"),
    nextDate: text("next_date").notNull(),
    /** Tarihi gelince otomatik hareket oluşturulsun mu? */
    autoPost: integer("auto_post", { mode: "boolean" }).notNull().default(false),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    notes: text("notes"),
  },
  (t) => [index("recurring_next_idx").on(t.nextDate, t.isActive)],
);

/* ──────────────────────────── Bütçe & Hedefler ────────────────────────────── */

export const budgets = sqliteTable(
  "budgets",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    categoryId: integer("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),
    /** 'YYYY-MM' ya da her ay geçerliyse NULL */
    month: text("month"),
    amountMinor: integer("amount_minor").notNull(),
    currency: text("currency").notNull().default("TRY"),
  },
  (t) => [uniqueIndex("budgets_cat_month_idx").on(t.categoryId, t.month)],
);

export const savingsGoals = sqliteTable("savings_goals", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  targetMinor: integer("target_minor").notNull(),
  currency: text("currency").notNull().default("TRY"),
  targetDate: text("target_date"),
  accountId: integer("account_id").references(() => accounts.id, {
    onDelete: "set null",
  }),
  /** Hesaba bağlı değilse elle güncellenen tutar. */
  manualSavedMinor: integer("manual_saved_minor").notNull().default(0),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  color: text("color").notNull().default("#10b981"),
  notes: text("notes"),
});

/* ─────────────────────────────── Yatırımlar ──────────────────────────────── */

/**
 * Elde tutulan bir yatırım kalemi: TEFAS fonu, NASDAQ hissesi, BIST hissesi.
 *
 * Birimler tam sayı tutulur, ondalık asla float'a bırakılmaz:
 *  - `quantityMicro`  : adet × 1e6 (fonlarda pay adedi kesirlidir)
 *  - `totalCostMinor` : ödenen toplam tutar, `currency` biriminin kuruşu
 *
 * Toplam maliyet birim maliyet yerine saklanır: yeni alım eklendiğinde
 * ağırlıklı ortalama yeniden hesaplanmaz, sadece toplamlar artar — böylece
 * yuvarlama hatası birikmez.
 */
export const holdings = sqliteTable(
  "holdings",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** fon | hisse */
    kind: text("kind").notNull().default("hisse"),
    /** tefas | bist | nasdaq | diger */
    market: text("market").notNull(),
    /** Sade kod: PHE, THYAO, AAPL. Sağlayıcıya özel ek (.IS) türetilir. */
    symbol: text("symbol").notNull(),
    name: text("name").notNull(),
    /** Fiyatın kote edildiği para birimi: TEFAS/BIST için TRY, NASDAQ için USD. */
    currency: text("currency").notNull().default("TRY"),

    quantityMicro: integer("quantity_micro").notNull().default(0),
    totalCostMinor: integer("total_cost_minor").notNull().default(0),
    /**
     * Cebinden çıkan TL toplamı. NASDAQ hissesini 30 TL'lik dolarla aldıysan
     * gerçek getirin kurdaki hareketi de içerir; maliyeti bugünkü kurla
     * yeniden değerlemek o kazancı görünmez yapar. Girilmezse bugünkü kurdan
     * tahmin edilir ve tahmin olduğu belirtilir.
     */
    totalCostTryMinor: integer("total_cost_try_minor"),

    /** fonoloji | yahoo | manuel */
    provider: text("provider").notNull().default("yahoo"),
    /** Sağlayıcı yoksa elle girilen fiyat (birim fiyat × 1e6). */
    manualPriceMicro: integer("manual_price_micro"),

    /** Hangi aracı kurumda/hesapta tutuluyor. */
    brokerAccountId: integer("broker_account_id").references(() => accounts.id, {
      onDelete: "set null",
    }),

    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    excludeFromNetWorth: integer("exclude_from_net_worth", { mode: "boolean" })
      .notNull()
      .default(false),
    color: text("color").notNull().default("#8b5cf6"),
    sortOrder: integer("sort_order").notNull().default(0),
    notes: text("notes"),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [index("holdings_symbol_idx").on(t.provider, t.symbol)],
);

/**
 * Fiyat önbelleği.
 *
 * Anahtar PAZAR + sembol'dür, sağlayıcı değil: bir pazarın fiyatı birden çok
 * kaynaktan gelebilir (BIST için önce TradingView, olmazsa Yahoo) ve kaynak
 * değiştiğinde aynı hisse için ikinci bir satır oluşmamalı. Fiyatı gerçekte
 * hangi kaynağın verdiği `source` alanında durur.
 *
 * `priceMicro` = birim fiyat × 1e6, `currency` biriminde.
 */
export const quotes = sqliteTable(
  "quotes",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** tefas | bist | nasdaq | diger */
    market: text("market").notNull(),
    /** Kullanıcının yazdığı sade kod: THYAO, AAPL, IJC. */
    symbol: text("symbol").notNull(),
    /** Fiyatı veren kaynak: tradingview | stooq | yahoo | fonoloji | manuel */
    source: text("source"),
    priceMicro: integer("price_micro"),
    currency: text("currency").notNull().default("TRY"),
    /** Önceki kapanış — günlük değişim bundan türetilir. */
    previousCloseMicro: integer("previous_close_micro"),
    /** Fiyatın ait olduğu gün (YYYY-MM-DD). */
    asOf: text("as_of"),
    fetchedAt: integer("fetched_at").notNull().default(now),
    /** Son denemede hata olduysa mesajı; başarıda null. */
    error: text("error"),
    /**
     * Ayrıştırma başarısızsa yanıtın kırpılmış hali. Sağlayıcının alan
     * adları değiştiğinde körlemesine tahmin etmek yerine ne döndüğü görülür.
     */
    rawSample: text("raw_sample"),
  },
  (t) => [uniqueIndex("quotes_market_symbol_idx").on(t.market, t.symbol)],
);

/* ────────────────────────────── Döviz Kurları ─────────────────────────────── */

/** rateMicro = 1 birim dövizin TL karşılığı * 1e6 */
export const exchangeRates = sqliteTable(
  "exchange_rates",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    code: text("code").notNull(),
    date: text("date").notNull(),
    rateMicro: integer("rate_micro").notNull(),
    /** tcmb | manuel */
    source: text("source").notNull().default("manuel"),
    fetchedAt: integer("fetched_at").notNull().default(now),
  },
  (t) => [uniqueIndex("fx_code_date_idx").on(t.code, t.date)],
);

/* ────────────────────────────── Bildirimler ───────────────────────────────── */

/**
 * Üretilen uyarılar. dedupeKey sayesinde aynı uyarı aynı gün iki kez gitmez.
 * severity: bilgi | uyari | kritik
 */
export const notifications = sqliteTable(
  "notifications",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    dedupeKey: text("dedupe_key").notNull().unique(),
    type: text("type").notNull(),
    severity: text("severity").notNull().default("bilgi"),
    title: text("title").notNull(),
    body: text("body").notNull(),
    /** Uyarının ilgili olduğu tarih (ör. son ödeme günü). */
    targetDate: text("target_date"),
    entityType: text("entity_type"),
    entityId: integer("entity_id"),
    /** Gönderildiği kanallar, virgülle ayrık. */
    channels: text("channels"),
    sentAt: integer("sent_at"),
    readAt: integer("read_at"),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [index("notifications_created_idx").on(t.createdAt)],
);

/* ───────────────────────── Toplu içe aktarma taslağı ──────────────────────── */

/** Ekstre yapıştırma ekranında onay bekleyen satırlar. */
export const importDrafts = sqliteTable("import_drafts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  label: text("label"),
  rawText: text("raw_text").notNull(),
  parsedJson: text("parsed_json").notNull(),
  targetAccountId: integer("target_account_id"),
  targetCardId: integer("target_card_id"),
  status: text("status").notNull().default("taslak"),
  createdAt: integer("created_at").notNull().default(now),
});

/* ────────────────────────────────── Tipler ────────────────────────────────── */

export type User = typeof users.$inferSelect;
export type Institution = typeof institutions.$inferSelect;
export type Account = typeof accounts.$inferSelect;
export type Card = typeof cards.$inferSelect;
export type Statement = typeof statements.$inferSelect;
export type Category = typeof categories.$inferSelect;
export type Merchant = typeof merchants.$inferSelect;
export type Transaction = typeof transactions.$inferSelect;
export type InstallmentPlan = typeof installmentPlans.$inferSelect;
export type Installment = typeof installments.$inferSelect;
export type Subscription = typeof subscriptions.$inferSelect;
export type Loan = typeof loans.$inferSelect;
export type LoanPayment = typeof loanPayments.$inferSelect;
export type RecurringItem = typeof recurringItems.$inferSelect;
export type Budget = typeof budgets.$inferSelect;
export type SavingsGoal = typeof savingsGoals.$inferSelect;
export type Holding = typeof holdings.$inferSelect;
export type Quote = typeof quotes.$inferSelect;
export type ExchangeRate = typeof exchangeRates.$inferSelect;
export type Notification = typeof notifications.$inferSelect;

export type NewAccount = typeof accounts.$inferInsert;
export type NewCard = typeof cards.$inferInsert;
export type NewTransaction = typeof transactions.$inferInsert;
export type NewInstallmentPlan = typeof installmentPlans.$inferInsert;
export type NewSubscription = typeof subscriptions.$inferInsert;
export type NewLoan = typeof loans.$inferInsert;
