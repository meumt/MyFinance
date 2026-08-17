import { loadSnapshot } from "@/lib/data";
import { refreshQuotes } from "@/lib/quotes";
import { InvestmentsClient, type HoldingRow } from "./investments-client";

export const metadata = { title: "Yatırımlar" };
export const dynamic = "force-dynamic";

export default async function InvestmentsPage() {
  /* Sayfa açılışında bayat fiyatları tazele.
     TTL içindeyse ağa hiç çıkılmaz — ücretsiz kotayı her yenilemede
     harcamamak için kontrol `refreshQuotes` içinde yapılır. Hata olursa
     sayfa yine açılır: eski fiyatlarla göstermek, hiç göstermemekten iyidir. */
  const preSnap = await loadSnapshot();
  if (preSnap.settings.autoRefreshQuotes && preSnap.holdings.length > 0) {
    await refreshQuotes({ holdings: preSnap.holdings }).catch(() => undefined);
  }

  /* Fiyatlar değişmiş olabileceği için değerleme tazelenmiş veriyle kurulur. */
  const snap = await loadSnapshot();
  const portfolio = snap.portfolio;

  const rows: HoldingRow[] = portfolio.items.map((item) => ({
    id: item.holding.id,
    kind: item.holding.kind,
    market: item.holding.market,
    symbol: item.holding.symbol,
    name: item.holding.name,
    currency: item.holding.currency,
    quantityMicro: item.holding.quantityMicro,
    totalCostMinor: item.holding.totalCostMinor,
    totalCostTryMinor: item.holding.totalCostTryMinor,
    provider: item.holding.provider,
    manualPriceMicro: item.holding.manualPriceMicro,
    brokerAccountId: item.holding.brokerAccountId,
    brokerName: item.holding.brokerAccountId
      ? (snap.accountById.get(item.holding.brokerAccountId)?.name ?? null)
      : null,
    excludeFromNetWorth: item.holding.excludeFromNetWorth,
    notes: item.holding.notes,

    priceMicro: item.priceMicro,
    isManualPrice: item.isManualPrice,
    valueMinor: item.valueMinor,
    valueTryMinor: item.valueTryMinor,
    costTryMinor: item.costTryMinor,
    costTryIsEstimate: item.costTryIsEstimate,
    gainTryMinor: item.gainTryMinor,
    gainRatio: item.gainRatio,
    dayChangeRatio: item.dayChangeRatio,
    dayChangeTryMinor: item.dayChangeTryMinor,
    unitCostMicro: item.unitCostMicro,
    weight: item.weight,
    asOf: item.asOf,
    fetchedAt: item.fetchedAt,
    quoteError: item.quoteError,
  }));

  return (
    <InvestmentsClient
      rows={rows}
      totals={{
        valueTryMinor: portfolio.valueTryMinor,
        costTryMinor: portfolio.costTryMinor,
        gainTryMinor: portfolio.gainTryMinor,
        gainRatio: portfolio.gainRatio,
        dayChangeTryMinor: portfolio.dayChangeTryMinor,
        dayChangeRatio: portfolio.dayChangeRatio,
        missingPriceCount: portfolio.missingPriceCount,
        missingRates: portfolio.missingRates,
        oldestFetchedAt: portfolio.oldestFetchedAt,
        errorCount: portfolio.errorCount,
      }}
      byMarket={portfolio.byMarket}
      accounts={snap.accounts
        .filter((a) => a.isActive)
        .map((a) => ({ value: a.id, label: a.name }))}
      hasFonolojiKey={snap.settings.fonolojiApiKey.length > 0}
    />
  );
}
