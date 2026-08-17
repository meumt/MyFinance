"use client";

import {
  ChartCandlestick,
  Minus,
  Pencil,
  Plus,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";
import { useState } from "react";

import {
  addPurchaseAction,
  addSaleAction,
  deleteHoldingAction,
  refreshQuotesAction,
  saveHoldingAction,
} from "@/app/actions/investments";
import { Alert, Gizli, Money } from "@/components/display";
import {
  CheckboxField,
  FieldRow,
  MoneyField,
  NumberField,
  SelectField,
  TextField,
  type Option,
} from "@/components/fields";
import { ActionButton, DeleteButton, FormDialog } from "@/components/form-dialog";
import {
  Badge,
  Button,
  EmptyState,
  Panel,
  PanelHeader,
  ProgressBar,
} from "@/components/ui";
import { formatDateTR, formatTimestampTR } from "@/lib/dates";
import { formatMoney, formatPercent, minorToInputString } from "@/lib/money";
import {
  formatQuantity,
  formatUnitPrice,
  MARKET_LABEL,
  QTY_SCALE,
  PRICE_SCALE,
  type Market,
  type PortfolioGroup,
} from "@/lib/portfolio";

export interface HoldingRow {
  id: number;
  kind: string;
  market: string;
  symbol: string;
  name: string;
  currency: string;
  quantityMicro: number;
  totalCostMinor: number;
  totalCostTryMinor: number | null;
  provider: string;
  manualPriceMicro: number | null;
  brokerAccountId: number | null;
  brokerName: string | null;
  excludeFromNetWorth: boolean;
  notes: string | null;

  priceMicro: number | null;
  isManualPrice: boolean;
  valueMinor: number | null;
  valueTryMinor: number | null;
  costTryMinor: number;
  costTryIsEstimate: boolean;
  gainTryMinor: number | null;
  gainRatio: number | null;
  dayChangeRatio: number | null;
  dayChangeTryMinor: number | null;
  unitCostMicro: number | null;
  weight: number;
  asOf: string | null;
  fetchedAt: number | null;
  quoteError: string | null;
}

export interface Totals {
  valueTryMinor: number;
  costTryMinor: number;
  gainTryMinor: number;
  gainRatio: number;
  dayChangeTryMinor: number;
  dayChangeRatio: number;
  missingPriceCount: number;
  missingRates: string[];
  oldestFetchedAt: number | null;
  errorCount: number;
}

const MARKET_OPTIONS: Option[] = (
  ["tefas", "bist", "nasdaq", "diger"] as Market[]
).map((m) => ({ value: m, label: MARKET_LABEL[m] }));

export function InvestmentsClient({
  rows,
  totals,
  byMarket,
  accounts,
  hasFonolojiKey,
}: {
  rows: HoldingRow[];
  totals: Totals;
  byMarket: PortfolioGroup[];
  accounts: Option[];
  hasFonolojiKey: boolean;
}) {
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<HoldingRow | null>(null);
  const [buying, setBuying] = useState<HoldingRow | null>(null);
  const [selling, setSelling] = useState<HoldingRow | null>(null);

  const needsFonolojiKey =
    !hasFonolojiKey && rows.some((r) => r.provider === "fonoloji");

  return (
    <div className="space-y-4">
      {/* Portföy özeti */}
      <div className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4">
        <Panel className="p-3 sm:p-4">
          <p className="faint text-[11px] font-medium tracking-wide uppercase">
            Portföy değeri
          </p>
          <Money
            minor={totals.valueTryMinor}
            tone="nötr"
            className="mt-1 block text-lg font-semibold sm:text-xl"
          />
          <Gizli className="muted mt-0.5 block text-[11px]">
            maliyet {formatMoney(totals.costTryMinor, "TRY", { compact: true })}
          </Gizli>
        </Panel>

        <Panel className="p-3 sm:p-4">
          <p className="faint text-[11px] font-medium tracking-wide uppercase">
            Toplam kâr / zarar
          </p>
          <Money
            minor={totals.gainTryMinor}
            signed
            className="mt-1 block text-lg font-semibold sm:text-xl"
          />
          <Gizli className="muted mt-0.5 block text-[11px]">
            {totals.costTryMinor > 0 ? formatPercent(totals.gainRatio, 1) : "—"}
          </Gizli>
        </Panel>

        <Panel className="p-3 sm:p-4">
          <p className="faint text-[11px] font-medium tracking-wide uppercase">
            Günlük değişim
          </p>
          <Money
            minor={totals.dayChangeTryMinor}
            signed
            className="mt-1 block text-lg font-semibold sm:text-xl"
          />
          <Gizli className="muted mt-0.5 block text-[11px]">
            {totals.dayChangeTryMinor !== 0
              ? formatPercent(totals.dayChangeRatio, 2)
              : "önceki kapanış bilinmiyor"}
          </Gizli>
        </Panel>

        <Panel className="p-3 sm:p-4">
          <p className="faint text-[11px] font-medium tracking-wide uppercase">
            Kalem sayısı
          </p>
          <p className="tabular mt-1 text-lg font-semibold sm:text-xl">
            {rows.length}
          </p>
          <p className="muted mt-0.5 text-[11px]">
            {totals.oldestFetchedAt
              ? `fiyatlar ${formatTimestampTR(totals.oldestFetchedAt)}`
              : "fiyat çekilmedi"}
          </p>
        </Panel>
      </div>

      {/* Eksik/hatalı durumlar — toplamın neden eksik olduğu açıkça söylenir */}
      {needsFonolojiKey ||
      totals.missingPriceCount > 0 ||
      totals.missingRates.length > 0 ||
      totals.errorCount > 0 ? (
        <div className="space-y-2.5">
          {needsFonolojiKey ? (
            <Alert
              tone="uyari"
              title="Fon fiyatları için Fonoloji anahtarı gerekiyor"
              action={
                <a
                  href="/ayarlar#yatirim"
                  className="focus-ring text-xs font-semibold underline underline-offset-2"
                >
                  Ayarlar
                </a>
              }
            >
              TEFAS fonlarının birim pay değerini çekmek için Ayarlar → Yatırım
              bölümüne API anahtarını girin. Anahtar olmadan fonların değeri
              hesaplanamaz.
            </Alert>
          ) : null}

          {totals.missingPriceCount > 0 ? (
            <Alert tone="uyari" title={`${totals.missingPriceCount} kalemin fiyatı yok`}>
              Bu kalemler portföy toplamına <strong>dahil edilmedi</strong> —
              yanlış bir toplam göstermek yerine eksik gösteriliyor. Sembolü
              kontrol edin ya da birim fiyatı elle girin.
            </Alert>
          ) : null}

          {totals.missingRates.length > 0 ? (
            <Alert
              tone="uyari"
              title={`Kur bilinmiyor: ${totals.missingRates.join(", ")}`}
              action={
                <a
                  href="/ayarlar#kur"
                  className="focus-ring text-xs font-semibold underline underline-offset-2"
                >
                  Kurlar
                </a>
              }
            >
              Dövizli kalemler TL karşılığına çevrilemediği için toplama
              girmedi. Ayarlardan kuru güncelleyin.
            </Alert>
          ) : null}
        </div>
      ) : null}

      {/* Pazar dağılımı */}
      {byMarket.length > 1 ? (
        <Panel>
          <PanelHeader title="Dağılım" subtitle="Pazara göre portföy ağırlığı" />
          <ul className="px-4 py-3 sm:px-5">
            {byMarket.map((group) => (
              <li key={group.key} className="mb-2.5 last:mb-0">
                <div className="mb-1 flex items-baseline justify-between gap-3">
                  <span className="truncate text-xs font-medium">
                    {group.label}
                    <span className="faint ml-1.5">{group.count} kalem</span>
                  </span>
                  <span className="tabular shrink-0 text-xs">
                    <Gizli className="font-semibold">
                      {formatMoney(group.valueTryMinor, "TRY", { compact: true })}
                    </Gizli>
                    <span className="faint"> · {formatPercent(group.ratio, 0)}</span>
                  </span>
                </div>
                <ProgressBar ratio={group.ratio} tone="brand" />
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      {/* Kalemler */}
      <Panel>
        <PanelHeader
          title="Yatırımlarım"
          subtitle="Fon, Borsa İstanbul ve NASDAQ kalemleri"
          action={
            <div className="flex items-center gap-1.5">
              <ActionButton
                action={refreshQuotesAction}
                title="Fiyatları şimdi yenile"
              >
                <RefreshCw size={14} />
              </ActionButton>
              <Button variant="primary" onClick={() => setCreating(true)}>
                <Plus size={14} /> Ekle
              </Button>
            </div>
          }
        />

        {rows.length === 0 ? (
          <EmptyState
            icon={<ChartCandlestick size={28} />}
            title="Henüz yatırım eklenmedi"
            description="Fonlarını, BIST ve NASDAQ hisselerini ekle; adet ve ödediğin tutarı yaz, değerlemeyi ve kâr/zararı sistem hesaplar."
            action={
              <Button variant="primary" onClick={() => setCreating(true)}>
                İlk kalemi ekle
              </Button>
            }
          />
        ) : (
          <ul>
            {rows.map((row) => (
              <li key={row.id} className="border-b px-4 py-3 last:border-b-0 sm:px-5">
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="truncate text-sm font-semibold">{row.symbol}</p>
                      <Badge tone="nötr">
                        {MARKET_LABEL[row.market as Market] ?? row.market}
                      </Badge>
                      {row.isManualPrice ? <Badge tone="uyari">elle fiyat</Badge> : null}
                      {row.excludeFromNetWorth ? (
                        <Badge tone="nötr">net değer dışı</Badge>
                      ) : null}
                    </div>

                    {row.name && row.name !== row.symbol ? (
                      <p className="faint truncate text-[11px]">{row.name}</p>
                    ) : null}

                    <Gizli className="muted mt-1 block text-[11px]">
                      {formatQuantity(row.quantityMicro)} adet
                      {row.priceMicro != null
                        ? ` × ${formatUnitPrice(row.priceMicro, row.currency)}`
                        : ""}
                      {row.unitCostMicro != null
                        ? ` · maliyet ${formatUnitPrice(row.unitCostMicro, row.currency)}`
                        : ""}
                    </Gizli>

                    {row.brokerName ? (
                      <p className="faint text-[11px]">{row.brokerName}</p>
                    ) : null}
                  </div>

                  <div className="shrink-0 text-right">
                    {row.valueTryMinor != null ? (
                      <>
                        <Money
                          minor={row.valueTryMinor}
                          tone="nötr"
                          className="block text-sm font-semibold"
                        />
                        {row.gainTryMinor != null ? (
                          <Money
                            minor={row.gainTryMinor}
                            signed
                            className="block text-[11px]"
                          />
                        ) : null}
                        {row.gainRatio != null ? (
                          <Gizli
                            className={`block text-[10px] ${row.gainRatio >= 0 ? "text-gelir" : "text-gider"}`}
                          >
                            {formatPercent(row.gainRatio, 1)}
                          </Gizli>
                        ) : null}
                      </>
                    ) : (
                      <Badge tone="uyari">fiyat yok</Badge>
                    )}
                  </div>
                </div>

                {/* Dövizli kalemde kendi biriminde değeri de göster */}
                {row.currency !== "TRY" && row.valueMinor != null ? (
                  <Gizli className="faint mt-1 block text-[10px]">
                    {formatMoney(row.valueMinor, row.currency)} ·{" "}
                    {row.costTryIsEstimate
                      ? "maliyet bugünkü kurdan tahmin"
                      : "maliyet ödediğin TL"}
                  </Gizli>
                ) : null}

                {row.dayChangeRatio != null ? (
                  <Gizli
                    className={`mt-1 block text-[10px] ${row.dayChangeRatio >= 0 ? "text-gelir" : "text-gider"}`}
                  >
                    bugün {formatPercent(row.dayChangeRatio, 2)}
                    {row.dayChangeTryMinor != null
                      ? ` (${formatMoney(row.dayChangeTryMinor, "TRY", { signed: true, compact: true })})`
                      : ""}
                  </Gizli>
                ) : null}

                {row.quoteError ? (
                  <p className="text-uyari mt-1 flex items-start gap-1 text-[10px]">
                    <TriangleAlert size={11} className="mt-px shrink-0" />
                    <span>{row.quoteError}</span>
                  </p>
                ) : null}

                {row.asOf ? (
                  <p className="faint mt-1 text-[10px]">
                    fiyat tarihi {formatDateTR(row.asOf)}
                  </p>
                ) : null}

                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <Button size="sm" variant="ghost" onClick={() => setBuying(row)}>
                    <Plus size={13} /> Alım
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setSelling(row)}>
                    <Minus size={13} /> Satış
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(row)}>
                    <Pencil size={13} /> Düzenle
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <p className="faint px-4 py-3 text-[11px] leading-relaxed sm:px-5">
          Fiyatlar Borsa İstanbul ve NASDAQ için Yahoo Finance'ten, fonlar için
          Fonoloji'den alınır ve 15 dakika önbelleklenir — sayfayı her açışta
          yeniden istek atılmaz. Veriler gecikmeli olabilir; işlem kararı için
          değil takip için kullanın. Yatırımlar net değere girer,{" "}
          <strong>harcanabilir tutara girmez</strong>.
        </p>
      </Panel>

      {/* Yeni kalem */}
      <FormDialog
        title="Yatırım ekle"
        description="Adet ve ödediğin toplam tutarı yaz; gerisini sistem hesaplar."
        action={saveHoldingAction}
        open={creating}
        onOpenChange={setCreating}
      >
        <HoldingFields accounts={accounts} />
      </FormDialog>

      {editing ? (
        <FormDialog
          key={`edit-${editing.id}`}
          title={editing.symbol}
          action={saveHoldingAction}
          open
          onOpenChange={(open) => !open && setEditing(null)}
          submitLabel="Kaydet"
        >
          <input type="hidden" name="id" value={editing.id} />
          <HoldingFields accounts={accounts} row={editing} />
          <div className="border-t pt-3.5">
            <DeleteButton
              action={deleteHoldingAction}
              id={editing.id}
              label="Kalemi sil"
            />
          </div>
        </FormDialog>
      ) : null}

      {/* Alım ekle */}
      {buying ? (
        <FormDialog
          key={`buy-${buying.id}`}
          title={`${buying.symbol} — alım ekle`}
          description="Ortalama maliyetin kendiliğinden güncellenir."
          action={addPurchaseAction}
          open
          onOpenChange={(open) => !open && setBuying(null)}
          submitLabel="Alımı ekle"
        >
          <input type="hidden" name="id" value={buying.id} />
          <FieldRow>
            <TextField
              name="quantity"
              label="Alınan adet"
              required
              inputMode="decimal"
              placeholder="örn. 100 ya da 1.234,5678"
            />
            <MoneyField
              name="cost"
              label={`Ödenen (${buying.currency})`}
              required
            />
          </FieldRow>
          {buying.currency !== "TRY" ? (
            <MoneyField
              name="costTry"
              label="Cebinden çıkan TL"
              hint="Girmezsen gerçek getirin kur etkisiyle karışır."
            />
          ) : null}
        </FormDialog>
      ) : null}

      {/* Satış */}
      {selling ? (
        <FormDialog
          key={`sell-${selling.id}`}
          title={`${selling.symbol} — satış`}
          description={`Elinizde ${formatQuantity(selling.quantityMicro)} adet var. Maliyet oransal düşülür.`}
          action={addSaleAction}
          open
          onOpenChange={(open) => !open && setSelling(null)}
          submitLabel="Satışı kaydet"
        >
          <input type="hidden" name="id" value={selling.id} />
          <FieldRow>
            <TextField
              name="quantity"
              label="Satılan adet"
              required
              inputMode="decimal"
              defaultValue={formatQuantity(selling.quantityMicro)}
            />
            <MoneyField
              name="proceeds"
              label={`Gelen (${selling.currency})`}
              required
            />
          </FieldRow>
        </FormDialog>
      ) : null}
    </div>
  );
}

function HoldingFields({
  accounts,
  row,
}: {
  accounts: Option[];
  row?: HoldingRow;
}) {
  /* Pazar değiştiğinde para birimi ve sağlayıcı sunucuda türetilir; burada
     yalnızca mevcut değer gösterilir. Böylece istemci tarafında ikinci bir
     doğruluk kaynağı oluşmaz. */
  return (
    <>
      <FieldRow>
        <SelectField
          name="market"
          label="Pazar"
          required
          options={MARKET_OPTIONS}
          defaultValue={row?.market ?? "bist"}
          hint="TEFAS → Fonoloji, BIST/NASDAQ → Yahoo"
        />
        <SelectField
          name="kind"
          label="Tür"
          options={[
            { value: "hisse", label: "Hisse" },
            { value: "fon", label: "Fon" },
          ]}
          defaultValue={row?.kind ?? "hisse"}
        />
      </FieldRow>

      <FieldRow>
        <TextField
          name="symbol"
          label="Kod / sembol"
          required
          defaultValue={row?.symbol}
          placeholder="THYAO · AAPL · PHE"
          hint="Borsa İstanbul için sade kod yeter, .IS eklenir."
        />
        <TextField
          name="name"
          label="Ad"
          defaultValue={row?.name}
          placeholder="boş bırakılırsa çekilir"
        />
      </FieldRow>

      <FieldRow>
        <TextField
          name="quantity"
          label="Adet"
          required
          inputMode="decimal"
          defaultValue={row ? formatQuantity(row.quantityMicro) : undefined}
          placeholder="100 ya da 1.234,5678"
          hint="Fonlarda pay adedi kesirli olabilir."
        />
        <MoneyField
          name="totalCost"
          label="Toplam maliyet"
          required
          defaultMinor={row?.totalCostMinor}
          hint="Bugüne kadar ödediğin toplam"
        />
      </FieldRow>

      <SelectField
        name="currency"
        label="Para birimi"
        options={[
          { value: "TRY", label: "TRY — Türk lirası" },
          { value: "USD", label: "USD — Dolar" },
          { value: "EUR", label: "EUR — Euro" },
        ]}
        defaultValue={row?.currency ?? "TRY"}
        hint="TEFAS ve BIST için TRY, NASDAQ için USD"
      />

      <MoneyField
        name="totalCostTry"
        label="Ödenen TL (dövizli kalemde)"
        defaultMinor={row?.totalCostTryMinor ?? undefined}
        hint="NASDAQ hissesi aldıysan cebinden çıkan TL. Boşsa bugünkü kurdan tahmin edilir."
      />

      <SelectField
        name="brokerAccountId"
        label="Aracı kurum / hesap"
        options={accounts}
        placeholder="Belirtme"
        defaultValue={row?.brokerAccountId}
      />

      <div className="border-t pt-3.5">
        <SelectField
          name="provider"
          label="Fiyat kaynağı"
          options={[
            { value: "", label: "Pazara göre otomatik" },
            { value: "yahoo", label: "Yahoo Finance" },
            { value: "fonoloji", label: "Fonoloji (TEFAS)" },
            { value: "manuel", label: "Elle gireceğim" },
          ]}
          defaultValue={row?.provider}
        />
        <div className="mt-3">
          <NumberField
            name="manualPrice"
            label="Birim fiyat (elle)"
            step="0.000001"
            defaultValue={
              row?.manualPriceMicro != null
                ? row.manualPriceMicro / PRICE_SCALE
                : undefined
            }
            hint="Sağlayıcı tanımıyorsa ya da fiyatı kendin izlemek istiyorsan."
          />
        </div>
      </div>

      <TextField name="notes" label="Not" defaultValue={row?.notes} />

      <div className="space-y-2 border-t pt-3.5">
        <CheckboxField
          name="excludeFromNetWorth"
          label="Net değere katma"
          hint="Takip et ama varlık toplamına ekleme."
          defaultChecked={row?.excludeFromNetWorth ?? false}
        />
        {row ? (
          <CheckboxField name="isActive" label="Etkin" defaultChecked />
        ) : null}
      </div>
    </>
  );
}

/** Kuruş girdisini form için biçimler — dışa aktarılmasa da okunurluk için. */
export const formatMinorForInput = minorToInputString;
export const QUANTITY_SCALE = QTY_SCALE;
