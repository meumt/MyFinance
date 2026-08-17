import "server-only";

import { desc } from "drizzle-orm";
import { db } from "@/db";
import {
  accounts,
  balanceSnapshots,
  budgets,
  cards,
  categories,
  installmentPlans,
  installments,
  institutions,
  loanPayments,
  loans,
  merchants,
  recurringItems,
  holdings,
  quotes,
  savingsGoals,
  subscriptions,
  transactions,
  type Account,
  type Budget,
  type Card,
  type Category,
  type Installment,
  type InstallmentPlan,
  type Institution,
  type Loan,
  type LoanPayment,
  type Merchant,
  type RecurringItem,
  type Holding,
  type Quote,
  type SavingsGoal,
  type Subscription,
  type Transaction,
} from "@/db/schema";
import { today, type ISODate } from "./dates";
import { getRatesFor, type RateMap } from "./fx";
import {
  computeAccountBalance,
  computeCardLedger,
  type AccountBalance,
  type CardLedger,
} from "./ledger";
import { buildPortfolio, type Portfolio } from "./portfolio";
import { getSettings, type AppSettings } from "./settings";

/**
 * Uygulamanın tüm finansal durumunu tek seferde yükler ve türetilmiş
 * hesaplamaları yapar. Kişisel ölçekte veri hacmi küçük olduğu için
 * bellekte hesaplamak hem daha basit hem de sayfalar arası tutarlılığı garanti eder.
 */
export interface FinancialSnapshot {
  ref: ISODate;
  settings: AppSettings;
  rates: RateMap;

  institutions: Institution[];
  accounts: Account[];
  cards: Card[];
  categories: Category[];
  merchants: Merchant[];
  transactions: Transaction[];
  plans: InstallmentPlan[];
  installments: Installment[];
  subscriptions: Subscription[];
  loans: Loan[];
  loanPayments: LoanPayment[];
  recurring: RecurringItem[];
  budgets: Budget[];
  goals: SavingsGoal[];
  holdings: Holding[];
  /** Fiyat önbelleği — anahtar `sağlayıcı:sembol`. */
  quotes: Map<string, Quote>;
  /** Değerlenmiş portföy. Fiyatı bilinmeyen kalem toplamı bozmaz. */
  portfolio: Portfolio;

  balances: Map<number, AccountBalance>;
  ledgers: Map<number, CardLedger>;

  categoryById: Map<number, Category>;
  accountById: Map<number, Account>;
  cardById: Map<number, Card>;
  institutionById: Map<number, Institution>;
  merchantById: Map<number, Merchant>;
  planById: Map<number, InstallmentPlan>;
}

export async function loadSnapshot(ref: ISODate = today()): Promise<FinancialSnapshot> {
  const [
    settings,
    rates,
    institutionRows,
    accountRows,
    cardRows,
    categoryRows,
    merchantRows,
    txRows,
    planRows,
    installmentRows,
    subscriptionRows,
    loanRows,
    loanPaymentRows,
    recurringRows,
    budgetRows,
    goalRows,
    snapshotRows,
    holdingRows,
    quoteRows,
  ] = await Promise.all([
    getSettings(),
    getRatesFor(ref),
    db.select().from(institutions),
    db.select().from(accounts),
    db.select().from(cards),
    db.select().from(categories),
    db.select().from(merchants),
    db.select().from(transactions).orderBy(desc(transactions.date), desc(transactions.id)),
    db.select().from(installmentPlans),
    db.select().from(installments),
    db.select().from(subscriptions),
    db.select().from(loans),
    db.select().from(loanPayments),
    db.select().from(recurringItems),
    db.select().from(budgets),
    db.select().from(savingsGoals),
    db.select().from(balanceSnapshots).orderBy(desc(balanceSnapshots.date)),
    db.select().from(holdings),
    db.select().from(quotes),
  ]);

  /* Hesap bakiyeleri — her hesap için en güncel mutabakat tabanı bulunur. */
  const latestSnapshotByAccount = new Map<number, { date: ISODate; balanceMinor: number }>();
  for (const s of snapshotRows) {
    if (s.date > ref) continue; // gelecek tarihli mutabakat dikkate alınmaz
    if (!latestSnapshotByAccount.has(s.accountId)) {
      latestSnapshotByAccount.set(s.accountId, {
        date: s.date,
        balanceMinor: s.balanceMinor,
      });
    }
  }

  const balances = new Map<number, AccountBalance>();
  for (const account of accountRows) {
    balances.set(
      account.id,
      computeAccountBalance(
        account,
        txRows,
        latestSnapshotByAccount.get(account.id) ?? null,
        rates,
      ),
    );
  }

  /* Kart defterleri. */
  const planIdsByCard = new Map<number, Set<number>>();
  for (const plan of planRows) {
    if (!planIdsByCard.has(plan.cardId)) planIdsByCard.set(plan.cardId, new Set());
    planIdsByCard.get(plan.cardId)!.add(plan.id);
  }

  /* Planın sisteme girildiği gün. Bu tarihten önceki ödenmiş taksitler
     kapanmış ekstrelere aittir ve borç olarak sayılmaz. */
  const planEntryDates = new Map<number, ISODate>(
    planRows.map((plan) => [plan.id, msToISODate(plan.createdAt)]),
  );

  /* Taksit planı kartın para biriminden farklı olabilir (dövizli alışveriş). */
  const planCurrencies = new Map<number, string>(
    planRows.map((plan) => [plan.id, plan.currency]),
  );

  const ledgers = new Map<number, CardLedger>();
  for (const card of cardRows) {
    const planIds = planIdsByCard.get(card.id) ?? new Set<number>();
    ledgers.set(
      card.id,
      computeCardLedger({
        card,
        transactions: txRows.filter(
          (t) => t.cardId === card.id || t.counterCardId === card.id,
        ),
        installments: installmentRows.filter((i) => planIds.has(i.planId)),
        planEntryDates,
        planCurrencies,
        rates,
        policy: settings.minimumPolicy,
        ref,
      }),
    );
  }

  /* Portföy değerlemesi. Fiyatlar önbellekten okunur; tazeleme sayfa
     tarafında yapılır ki her snapshot yüklemesi ağ isteği doğurmasın. */
  const quoteMap = new Map<string, Quote>(
    quoteRows.map((row) => [`${row.market}:${row.symbol}`, row]),
  );
  const portfolio = buildPortfolio({
    holdings: holdingRows,
    quotes: quoteMap,
    rates,
  });

  return {
    ref,
    settings,
    rates,
    institutions: institutionRows,
    accounts: accountRows,
    cards: cardRows,
    categories: categoryRows,
    merchants: merchantRows,
    transactions: txRows,
    plans: planRows,
    installments: installmentRows,
    subscriptions: subscriptionRows,
    loans: loanRows,
    loanPayments: loanPaymentRows,
    recurring: recurringRows,
    budgets: budgetRows,
    goals: goalRows,
    holdings: holdingRows,
    quotes: quoteMap,
    portfolio,
    balances,
    ledgers,
    categoryById: byId(categoryRows),
    accountById: byId(accountRows),
    cardById: byId(cardRows),
    institutionById: byId(institutionRows),
    merchantById: byId(merchantRows),
    planById: byId(planRows),
  };
}

function byId<T extends { id: number }>(rows: T[]): Map<number, T> {
  return new Map(rows.map((r) => [r.id, r]));
}

/** Unix zaman damgasını Türkiye saatine göre takvim tarihine çevirir. */
function msToISODate(ms: number): ISODate {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}

/** Kategori adını üst kategorisiyle birlikte döner: "Ulaşım › Yakıt" */
export function categoryPath(
  category: Category | undefined,
  byIdMap: Map<number, Category>,
): string {
  if (!category) return "Kategorisiz";
  if (!category.parentId) return category.name;
  const parent = byIdMap.get(category.parentId);
  return parent ? `${parent.name} › ${category.name}` : category.name;
}
