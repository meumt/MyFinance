import type { FinancialSnapshot } from "./data";
import { addMonthsToKey, type ISODate, monthEnd, monthKey } from "./dates";
import { upcomingObligations } from "./forecast";
import { toTRYOrZero } from "./fx";
import { periodForTransaction } from "./statements";

/**
 * Karta düşen bir harcamanın hangi ay nakde dönüşeceği: harcama tarihini
 * kapsayan ekstre döneminin son ödeme ayı.
 */
function cardDueMonthFor(
  snap: FinancialSnapshot,
  cardId: number,
  date: ISODate,
): string | null {
  const card = snap.cardById.get(cardId);
  if (!card || card.statementDay == null || card.dueDay == null) return null;
  const period = periodForTransaction(date, {
    statementDay: card.statementDay,
    dueDay: card.dueDay,
  });
  return monthKey(period.dueDate);
}

/**
 * "Önümü göremiyorum" sorusunun cevabı.
 *
 * Geçmiş harcama geçmişine İHTİYAÇ DUYMAZ — sadece bugünkü bakiyeler ve
 * bilinen gelecek hareketler (maaş, kart ekstreleri, taksitler, abonelikler,
 * kredi ödemeleri) üzerinden ay ay ilerler. Sisteme yeni veri girmiş biri
 * için de ilk günden anlamlı çalışır.
 *
 * Tek varsayım aylık yaşam gideridir (market, ulaşım, yemek…). Bilinen
 * ödemeler dışındaki bu harcama girilmezse plan olduğundan iyimser görünür;
 * bu yüzden girilmediği açıkça işaretlenir.
 */

export interface OutlookMonth {
  month: string;
  /** Ay başındaki beklenen likit bakiye. */
  openingMinor: number;
  /** Maaş ve diğer düzenli gelirler. */
  incomeMinor: number;
  cardDueMinor: number;
  loanMinor: number;
  subscriptionMinor: number;
  otherOutflowMinor: number;
  /** Varsayılan yaşam gideri — içinde bulunulan ayda kalan güne göre kırpılır. */
  livingCostMinor: number;
  outflowMinor: number;
  /** Gelir − çıkış. */
  netMinor: number;
  /** Ay sonunda beklenen likit bakiye. */
  closingMinor: number;
  /** Bu ay ödenen taksit tutarı (kart ekstresinin içinde, ayrıca sayılmaz). */
  installmentMinor: number;
}

export interface Outlook {
  months: OutlookMonth[];
  /** Bugünkü likit bakiye (ek hesap hariç). */
  startBalanceMinor: number;
  /** Ek hesap limiti — bakiye eksiye düşerse tampon. */
  overdraftHeadroomMinor: number;

  /** Şu an eksideyse, ilk kez artıya geçtiği ay. */
  firstPositiveMonth: string | null;
  /** En dip nokta: ay sonu bakiyesi en düşük ay. Dip bugünse null olur. */
  tightestMonth: string | null;
  tightestMinor: number;
  /** Dip nokta bugünse true — ileride değil, şu anda sıkışıksınız. */
  tightestIsToday: boolean;
  /** Ay sonu bakiyesinin eksiye düştüğü ilk ay (varsa). */
  firstNegativeMonth: string | null;
  /** Ek hesap limiti de yetmediği ilk ay — gerçek alarm budur. */
  firstOverdraftBreachMonth: string | null;

  /** Son taksitin ödendiği ay. */
  installmentFreeMonth: string | null;
  /** Bu ay taksitlere giden tutar. */
  currentInstallmentMinor: number;
  /** Taksitler bittiğinde her ay serbest kalan tutar (en yüksek aylık yük). */
  freedAfterInstallmentsMinor: number;

  /**
   * Düzene girdikten sonra ayda birikime/yatırıma ayrılabilecek tutar:
   * taksitler bittikten sonraki normal ayların ortalama neti.
   */
  investableMonthlyMinor: number;
  /** Yatırım tutarının hesaplandığı ilk normal ay. */
  investableFromMonth: string | null;

  /** Düzenli gelir tanımlanmamışsa projeksiyon anlamsızdır. */
  hasIncome: boolean;
  /** Aylık yaşam gideri varsayımı; 0 ise kullanıcı henüz girmemiştir. */
  assumedLivingCostMinor: number;
  /** Ufuk boyunca toplam gelir ve çıkış. */
  totalIncomeMinor: number;
  totalOutflowMinor: number;
}

export interface OutlookOptions {
  months?: number;
  /** Bilinen ödemeler dışında her ay giden tahmini tutar (kuruş, TL). */
  livingCostMinor?: number;
}

export function monthlyOutlook(
  snap: FinancialSnapshot,
  options: OutlookOptions = {},
): Outlook {
  const months = options.months ?? 12;
  const livingCost = Math.max(0, options.livingCostMinor ?? 0);
  const startMonth = monthKey(snap.ref);

  /* Bugünkü likit bakiye: aktif vadesiz/birikim hesapları. */
  let startBalance = 0;
  let overdraftHeadroom = 0;
  for (const account of snap.accounts) {
    if (!account.isActive || account.type === "vadeli") continue;
    const balance = snap.balances.get(account.id);
    if (!balance) continue;
    startBalance += toTRYOrZero(
      balance.balanceMinor,
      account.currency,
      snap.rates,
    );
    overdraftHeadroom += toTRYOrZero(
      balance.overdraftAvailableMinor,
      account.currency,
      snap.rates,
    );
  }

  /* Bilinen gelecek hareketler. Ufkun bir ay ötesine kadar alınır ki son ay
     yarım kalmasın. */
  const obligations = upcomingObligations(snap, {
    days: (months + 1) * 31,
    includeOverdue: true,
  });

  const buckets = new Map<string, OutlookMonth>();
  for (let i = 0; i < months; i++) {
    const m = addMonthsToKey(startMonth, i);
    buckets.set(m, {
      month: m,
      openingMinor: 0,
      incomeMinor: 0,
      cardDueMinor: 0,
      loanMinor: 0,
      subscriptionMinor: 0,
      otherOutflowMinor: 0,
      livingCostMinor: 0,
      outflowMinor: 0,
      netMinor: 0,
      closingMinor: 0,
      installmentMinor: 0,
    });
  }

  for (const o of obligations) {
    // Gecikmiş ödemeler bu aya yazılır; hâlâ ödenmeleri gerekiyor.
    const m = o.date < snap.ref ? startMonth : monthKey(o.date);

    /* Kartla ödenen abonelik ve düzenli giderler hesaptan o gün çıkmaz;
       ekstreye girip ekstrenin son ödeme günü çıkar. Sırf "nakit değil"
       diye atlanırlarsa plandan tamamen kaybolurlar — ekstre tahmini de
       henüz kaydedilmemiş yenilemeleri bilemez. */
    if (!o.isIncome && !o.affectsCash) {
      if (o.cardId == null) continue;
      const dueMonth = cardDueMonthFor(snap, o.cardId, o.date);
      const target = dueMonth ? buckets.get(dueMonth) : undefined;
      if (target) target.cardDueMinor += o.amountMinor;
      continue;
    }

    const bucket = buckets.get(m);
    if (!bucket) continue;

    if (o.isIncome) {
      bucket.incomeMinor += o.amountMinor;
      continue;
    }

    switch (o.type) {
      case "kart_ekstre":
        bucket.cardDueMinor += o.amountMinor;
        break;
      case "kredi_taksit":
        bucket.loanMinor += o.amountMinor;
        break;
      case "abonelik":
        bucket.subscriptionMinor += o.amountMinor;
        break;
      default:
        bucket.otherOutflowMinor += o.amountMinor;
    }
  }

  /* Taksitler kart ekstresinin içinde; ayrıca değil, bilgi olsun diye sayılır.
     Kaynak kart defteridir: sisteme girmeden önce ödenmiş taksitlerin
     ayıklanması ve döviz çevrimi orada bir kez yapılmıştır. */
  for (const card of snap.cards) {
    const ledger = snap.ledgers.get(card.id);
    if (!ledger) continue;
    for (const p of ledger.periods) {
      if (p.installmentsMinor <= 0) continue;
      const bucket = buckets.get(monthKey(p.period.dueDate));
      if (!bucket) continue;
      bucket.installmentMinor += toTRYOrZero(
        p.installmentsMinor,
        card.currency,
        snap.rates,
      );
    }
  }

  /* İçinde bulunulan ayın yaşam gideri, kalan güne göre orantılanır: ayın
     7'sindeysek o ayın tamamını yeniden harcayacakmışız gibi davranmak
     bakiyeyi olduğundan kötü gösterir. */
  const daysInMonth = Number(monthEnd(startMonth).slice(8));
  const dayOfMonth = Number(snap.ref.slice(8));
  const remainingRatio =
    Math.max(0, daysInMonth - dayOfMonth + 1) / daysInMonth;

  /* Ay ay yürü. */
  let running = startBalance;
  const list: OutlookMonth[] = [];
  for (const m of [...buckets.keys()].sort()) {
    const b = buckets.get(m)!;
    b.livingCostMinor =
      m === startMonth ? Math.round(livingCost * remainingRatio) : livingCost;
    b.openingMinor = running;
    b.outflowMinor =
      b.cardDueMinor +
      b.loanMinor +
      b.subscriptionMinor +
      b.otherOutflowMinor +
      b.livingCostMinor;
    b.netMinor = b.incomeMinor - b.outflowMinor;
    running += b.netMinor;
    b.closingMinor = running;
    list.push(b);
  }

  /* Öne çıkanlar. */
  const firstPositive =
    startBalance < 0
      ? (list.find((m) => m.closingMinor >= 0)?.month ?? null)
      : null;
  const firstNegative = list.find((m) => m.closingMinor < 0)?.month ?? null;
  const firstBreach =
    list.find((m) => m.closingMinor + overdraftHeadroom < 0)?.month ?? null;

  /* En dip nokta bugün de olabilir: maaş girmeden önceki bugünkü bakiye
     çoğu zaman ay sonlarından düşüktür. "En sıkışık ay" diye ileriyi
     göstermek, asıl sıkışıklığın şu an olduğunu gizler. */
  const tightestFuture = list.reduce<OutlookMonth | null>(
    (acc, m) => (acc === null || m.closingMinor < acc.closingMinor ? m : acc),
    null,
  );
  const tightestIsToday =
    tightestFuture === null || startBalance < tightestFuture.closingMinor;

  /* Son taksit ayı da defterden okunur: ödenmiş taksitler zaten dışarıda. */
  const installmentFreeMonth =
    [...list].reverse().find((m) => m.installmentMinor > 0)?.month ?? null;

  /* Taksitler bitince serbest kalan tutar, içinde bulunulan ayınki DEĞİL,
     taksit dönemi boyunca görülen en yüksek aylık yüktür: bu ayın ekstresi
     sisteme girmeden önce ödenmiş olabilir ve 0 çıkar. */
  const currentInstallment = list[0]?.installmentMinor ?? 0;
  const peakInstallment = installmentFreeMonth
    ? list
        .filter((m) => m.month <= installmentFreeMonth)
        .reduce((a, m) => Math.max(a, m.installmentMinor), 0)
    : 0;

  /* Düzene girdikten sonra ayda kalan: taksit yükü kalmayan ayların ortalama
     neti. Tek ay alınsaydı yıllık bir abonelik tabloyu bozardı. */
  const steady = list.filter(
    (m) =>
      m.month !== startMonth &&
      m.installmentMinor === 0 &&
      (installmentFreeMonth === null || m.month > installmentFreeMonth),
  );
  const investable =
    steady.length > 0
      ? Math.round(steady.reduce((s, m) => s + m.netMinor, 0) / steady.length)
      : 0;

  return {
    months: list,
    startBalanceMinor: startBalance,
    overdraftHeadroomMinor: overdraftHeadroom,
    firstPositiveMonth: firstPositive,
    tightestMonth: tightestIsToday ? null : (tightestFuture?.month ?? null),
    tightestMinor: tightestIsToday
      ? startBalance
      : (tightestFuture?.closingMinor ?? startBalance),
    tightestIsToday,
    firstNegativeMonth: firstNegative,
    firstOverdraftBreachMonth: firstBreach,
    installmentFreeMonth,
    currentInstallmentMinor: currentInstallment,
    freedAfterInstallmentsMinor: peakInstallment,
    investableMonthlyMinor: investable,
    investableFromMonth: steady[0]?.month ?? null,
    hasIncome: list.some((m) => m.incomeMinor > 0),
    assumedLivingCostMinor: livingCost,
    totalIncomeMinor: list.reduce((s, m) => s + m.incomeMinor, 0),
    totalOutflowMinor: list.reduce((s, m) => s + m.outflowMinor, 0),
  };
}
