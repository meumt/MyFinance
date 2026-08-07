"use client";

import { Filter, Pencil, Plus } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import {
  deleteTransactionAction,
  saveTransactionAction,
} from "@/app/actions/transactions";
import { initialsOf, Money } from "@/components/display";
import {
  CurrencyField,
  DateField,
  FieldRow,
  MoneyField,
  SelectField,
  TextField,
  type Option,
} from "@/components/fields";
import { DeleteButton, FormDialog } from "@/components/form-dialog";
import { Badge, Button, EmptyState, Field, Panel, Select, cn } from "@/components/ui";
import { formatDateShortTR, formatMonthTR } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { BulkImport } from "./bulk-import";

export interface TxView {
  id: number;
  date: string;
  kind: string;
  amountMinor: number;
  currency: string;
  accountId: number | null;
  cardId: number | null;
  counterAccountId: number | null;
  counterCardId: number | null;
  categoryId: number | null;
  merchantName: string | null;
  description: string | null;
  note: string | null;
  sourceName: string;
  sourceColor: string;
  categoryName: string | null;
  title: string;
  isInstallment: boolean;
}

const KINDS: Option[] = [
  { value: "gider", label: "Gider" },
  { value: "gelir", label: "Gelir" },
  { value: "transfer", label: "Hesaplar arası transfer" },
  { value: "kart_odeme", label: "Kredi kartı ödemesi" },
  { value: "iade", label: "İade" },
  { value: "faiz", label: "Faiz" },
  { value: "ucret", label: "Ücret / komisyon" },
];

const KIND_LABEL: Record<string, string> = Object.fromEntries(
  KINDS.map((k) => [k.value, k.label]),
);

export function TransactionsClient({
  transactions,
  accounts,
  cards,
  categories,
  months,
  filters,
  monthTotals,
  existingSignatures,
}: {
  transactions: TxView[];
  accounts: Option[];
  cards: Option[];
  categories: Option[];
  months: Array<{ value: string; label: string }>;
  filters: { month: string; source: string; kind: string; category: string };
  monthTotals: { incomeMinor: number; expenseMinor: number; netMinor: number };
  existingSignatures: string[];
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<TxView | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  function setFilter(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    router.push(`/hareketler?${next.toString()}`);
  }

  const sourceOptions: Option[] = [
    ...cards.map((c) => ({ ...c, value: `kart:${c.value}`, group: "Kartlar" })),
    ...accounts.map((a) => ({ ...a, value: `hesap:${a.value}`, group: "Hesaplar" })),
  ];

  /* Hareketleri güne göre grupla — uzun listelerde okunabilirliği artırır. */
  const grouped = transactions.reduce<Map<string, TxView[]>>((map, tx) => {
    if (!map.has(tx.date)) map.set(tx.date, []);
    map.get(tx.date)!.push(tx);
    return map;
  }, new Map());

  const activeFilterCount = [filters.source, filters.kind, filters.category].filter(
    Boolean,
  ).length;

  return (
    <div className="space-y-4">
      {/* Ay özeti */}
      <div className="grid grid-cols-3 gap-2.5 sm:gap-3">
        <Panel className="p-3 sm:p-4">
          <p className="faint text-[11px] font-medium tracking-wide uppercase">Gelir</p>
          <p className="tabular text-gelir mt-1 text-base font-semibold sm:text-lg">
            {formatMoney(monthTotals.incomeMinor, "TRY", { compact: true })}
          </p>
        </Panel>
        <Panel className="p-3 sm:p-4">
          <p className="faint text-[11px] font-medium tracking-wide uppercase">Gider</p>
          <p className="tabular text-gider mt-1 text-base font-semibold sm:text-lg">
            {formatMoney(monthTotals.expenseMinor, "TRY", { compact: true })}
          </p>
        </Panel>
        <Panel className="p-3 sm:p-4">
          <p className="faint text-[11px] font-medium tracking-wide uppercase">Net</p>
          <p
            className={cn(
              "tabular mt-1 text-base font-semibold sm:text-lg",
              monthTotals.netMinor >= 0 ? "text-gelir" : "text-gider",
            )}
          >
            {formatMoney(monthTotals.netMinor, "TRY", { compact: true, signed: true })}
          </p>
        </Panel>
      </div>

      <Panel>
        <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3 sm:px-5">
          <Select
            value={filters.month}
            onChange={(e) => setFilter("ay", e.target.value)}
            className="h-9 w-auto min-w-36 flex-1 sm:flex-none"
            aria-label="Ay seçin"
          >
            {months.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </Select>

          <Button
            size="sm"
            variant={activeFilterCount > 0 ? "primary" : "secondary"}
            onClick={() => setShowFilters((v) => !v)}
          >
            <Filter size={14} />
            Filtre
            {activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
          </Button>

          <div className="ml-auto flex gap-2">
            <BulkImport
              sources={sourceOptions}
              categories={categories}
              existingSignatures={existingSignatures}
            />
            <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
              <Plus size={14} />
              Hareket
            </Button>
          </div>
        </div>

        {showFilters ? (
          <div className="grid grid-cols-1 gap-2 border-b px-4 py-3 sm:grid-cols-3 sm:px-5">
            <Select
              value={filters.source}
              onChange={(e) => setFilter("kaynak", e.target.value)}
              className="h-9"
              aria-label="Hesap veya kart"
            >
              <option value="">Tüm hesap ve kartlar</option>
              <optgroup label="Kartlar">
                {cards.map((c) => (
                  <option key={c.value} value={`kart:${c.value}`}>
                    {c.label}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Hesaplar">
                {accounts.map((a) => (
                  <option key={a.value} value={`hesap:${a.value}`}>
                    {a.label}
                  </option>
                ))}
              </optgroup>
            </Select>

            <Select
              value={filters.kind}
              onChange={(e) => setFilter("tur", e.target.value)}
              className="h-9"
              aria-label="Hareket türü"
            >
              <option value="">Tüm türler</option>
              {KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </Select>

            <Select
              value={filters.category}
              onChange={(e) => setFilter("kategori", e.target.value)}
              className="h-9"
              aria-label="Kategori"
            >
              <option value="">Tüm kategoriler</option>
              {categories.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </Select>
          </div>
        ) : null}

        {transactions.length === 0 ? (
          <EmptyState
            title="Bu dönemde hareket yok"
            description="Alt çubuktaki + düğmesiyle hızlı giriş yapabilir ya da banka ekstrenizi toplu yapıştırabilirsiniz."
            action={
              <Button variant="primary" onClick={() => setCreating(true)}>
                Hareket ekle
              </Button>
            }
          />
        ) : (
          <div>
            {[...grouped.entries()].map(([date, items]) => {
              const dayTotal = items.reduce(
                (s, t) =>
                  s +
                  (t.kind === "gelir" || t.kind === "iade"
                    ? t.amountMinor
                    : t.kind === "transfer" || t.kind === "kart_odeme"
                      ? 0
                      : -t.amountMinor),
                0,
              );

              return (
                <div key={date}>
                  <div className="surface-2 flex items-center justify-between px-4 py-1.5 sm:px-5">
                    <span className="faint text-[11px] font-semibold">
                      {formatDateShortTR(date)}
                    </span>
                    <span
                      className={cn(
                        "tabular text-[11px] font-medium",
                        dayTotal >= 0 ? "text-gelir" : "muted",
                      )}
                    >
                      {formatMoney(dayTotal, "TRY", { signed: true })}
                    </span>
                  </div>

                  <ul>
                    {items.map((tx) => {
                      const isIncome = tx.kind === "gelir" || tx.kind === "iade";
                      const isNeutral =
                        tx.kind === "transfer" || tx.kind === "kart_odeme";

                      return (
                        <li
                          key={tx.id}
                          className="flex items-center gap-3 border-b px-4 py-2.5 last:border-b-0 sm:px-5"
                        >
                          <span
                            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white"
                            style={{ backgroundColor: tx.sourceColor }}
                            aria-hidden
                          >
                            {initialsOf(tx.title)}
                          </span>

                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">
                              {tx.title}
                              {tx.isInstallment ? (
                                <Badge tone="borc" className="ml-1.5">
                                  taksitli
                                </Badge>
                              ) : null}
                            </p>
                            <p className="faint truncate text-[11px]">
                              {tx.sourceName}
                              {tx.categoryName ? ` · ${tx.categoryName}` : ""}
                              {isNeutral ? ` · ${KIND_LABEL[tx.kind]}` : ""}
                            </p>
                          </div>

                          <Money
                            minor={isIncome ? tx.amountMinor : -tx.amountMinor}
                            currency={tx.currency}
                            signed={!isNeutral}
                            tone={isNeutral ? "nötr" : "auto"}
                            className={cn(
                              "shrink-0 text-sm font-semibold",
                              isNeutral && "muted",
                            )}
                          />

                          <button
                            onClick={() => setEditing(tx)}
                            className="focus-ring muted hover:bg-[var(--surface-2)] flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                            aria-label="Düzenle"
                          >
                            <Pencil size={14} />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </div>
        )}
      </Panel>

      <FormDialog
        title="Yeni hareket"
        action={saveTransactionAction}
        open={creating}
        onOpenChange={setCreating}
      >
        <TransactionFields
          accounts={accounts}
          cards={cards}
          categories={categories}
        />
      </FormDialog>

      {editing ? (
        <FormDialog
          key={editing.id}
          title="Hareketi düzenle"
          action={saveTransactionAction}
          open
          onOpenChange={(open) => !open && setEditing(null)}
        >
          <input type="hidden" name="id" value={editing.id} />
          <TransactionFields
            accounts={accounts}
            cards={cards}
            categories={categories}
            tx={editing}
          />
          <div className="flex justify-end border-t pt-3.5">
            <DeleteButton
              action={deleteTransactionAction}
              id={editing.id}
              label="Hareketi sil"
            />
          </div>
        </FormDialog>
      ) : null}
    </div>
  );
}

function TransactionFields({
  accounts,
  cards,
  categories,
  tx,
}: {
  accounts: Option[];
  cards: Option[];
  categories: Option[];
  tx?: TxView;
}) {
  const [kind, setKind] = useState(tx?.kind ?? "gider");
  const isTransfer = kind === "transfer";
  const isCardPayment = kind === "kart_odeme";

  return (
    <>
      {/* Tür seçimi kontrollü: değişince kaynak alanları buna göre değişir. */}
      <Field label="Hareket türü">
        <Select name="kind" value={kind} onChange={(e) => setKind(e.target.value)}>
          {KINDS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </Select>
      </Field>

      <FieldRow>
        <MoneyField
          name="amount"
          label="Tutar"
          required
          defaultMinor={tx?.amountMinor}
        />
        <DateField
          name="date"
          label="Tarih"
          required
          defaultValue={tx?.date ?? todayISO()}
        />
      </FieldRow>

      {isTransfer ? (
        <FieldRow>
          <SelectField
            name="accountId"
            label="Gönderen hesap"
            options={accounts}
            placeholder="Seçiniz"
            required
            defaultValue={tx?.accountId}
          />
          <SelectField
            name="counterAccountId"
            label="Alan hesap"
            options={accounts}
            placeholder="Seçiniz"
            required
            defaultValue={tx?.counterAccountId}
          />
        </FieldRow>
      ) : isCardPayment ? (
        <FieldRow>
          <SelectField
            name="accountId"
            label="Ödeyen hesap"
            options={accounts}
            placeholder="Seçiniz"
            required
            defaultValue={tx?.accountId}
          />
          <SelectField
            name="counterCardId"
            label="Ödenen kart"
            options={cards}
            placeholder="Seçiniz"
            required
            defaultValue={tx?.counterCardId}
          />
        </FieldRow>
      ) : (
        <FieldRow>
          <SelectField
            name="cardId"
            label="Kart"
            options={cards}
            placeholder="Kart kullanılmadı"
            defaultValue={tx?.cardId}
          />
          <SelectField
            name="accountId"
            label="Hesap"
            options={accounts}
            placeholder="Hesap kullanılmadı"
            defaultValue={tx?.accountId}
          />
        </FieldRow>
      )}

      {!isTransfer && !isCardPayment ? (
        <>
          <TextField
            name="merchantName"
            label="İşyeri"
            defaultValue={tx?.merchantName}
            placeholder="Örn. Migros"
            hint="Bir kez girdiğinizde kategorisi hatırlanır."
          />
          <SelectField
            name="categoryId"
            label="Kategori"
            options={categories}
            placeholder="Otomatik"
            defaultValue={tx?.categoryId}
          />
        </>
      ) : null}

      <TextField
        name="description"
        label="Açıklama"
        defaultValue={tx?.description}
      />

      <FieldRow>
        <CurrencyField defaultValue={tx?.currency ?? "TRY"} />
        <TextField name="note" label="Not" defaultValue={tx?.note} />
      </FieldRow>
    </>
  );
}

function todayISO(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
