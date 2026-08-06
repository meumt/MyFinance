"use client";

import { Check, Pencil, Receipt } from "lucide-react";
import { useState } from "react";

import {
  deleteRecurringAction,
  postRecurringAction,
  saveRecurringAction,
} from "@/app/actions/planning";
import { Money } from "@/components/display";
import {
  CheckboxField,
  CurrencyField,
  DateField,
  FieldRow,
  MoneyField,
  NumberField,
  SelectField,
  TextField,
  type Option,
} from "@/components/fields";
import { ActionButton, AddButton, DeleteButton, FormDialog } from "@/components/form-dialog";
import { Badge, Button, EmptyState, Panel, PanelHeader, cn } from "@/components/ui";
import { formatDateTR, relativeDayTR } from "@/lib/dates";
import { formatMoney } from "@/lib/money";

export interface RecurringView {
  id: number;
  name: string;
  kind: string;
  amountMinor: number;
  currency: string;
  cycle: string;
  dayOfMonth: number;
  accountId: number | null;
  cardId: number | null;
  categoryId: number | null;
  startDate: string;
  endDate: string | null;
  nextDate: string;
  autoPost: boolean;
  isActive: boolean;
  notes: string | null;
  targetLabel: string;
  daysUntil: number;
  amountTRYMinor: number;
}

const KINDS: Option[] = [
  { value: "gelir", label: "Gelir" },
  { value: "gider", label: "Gider" },
];

const CYCLES: Option[] = [
  { value: "aylik", label: "Aylık" },
  { value: "haftalik", label: "Haftalık" },
  { value: "yillik", label: "Yıllık" },
];

export function RecurringClient({
  items,
  accounts,
  cards,
  categories,
  totals,
}: {
  items: RecurringView[];
  accounts: Option[];
  cards: Option[];
  categories: Option[];
  totals: { incomeMinor: number; expenseMinor: number };
}) {
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<RecurringView | null>(null);

  const active = items.filter((i) => i.isActive);
  const inactive = items.filter((i) => !i.isActive);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2.5 sm:gap-3">
        <Panel className="p-3 sm:p-4">
          <p className="faint text-[11px] font-medium tracking-wide uppercase">
            Aylık gelir
          </p>
          <p className="tabular text-gelir mt-1 text-base font-semibold sm:text-lg">
            {formatMoney(totals.incomeMinor, "TRY", { compact: true })}
          </p>
        </Panel>
        <Panel className="p-3 sm:p-4">
          <p className="faint text-[11px] font-medium tracking-wide uppercase">
            Sabit gider
          </p>
          <p className="tabular text-gider mt-1 text-base font-semibold sm:text-lg">
            {formatMoney(totals.expenseMinor, "TRY", { compact: true })}
          </p>
        </Panel>
        <Panel className="p-3 sm:p-4">
          <p className="faint text-[11px] font-medium tracking-wide uppercase">
            Aylık fark
          </p>
          <p
            className={cn(
              "tabular mt-1 text-base font-semibold sm:text-lg",
              totals.incomeMinor - totals.expenseMinor >= 0 ? "text-gelir" : "text-gider",
            )}
          >
            {formatMoney(totals.incomeMinor - totals.expenseMinor, "TRY", {
              compact: true,
              signed: true,
            })}
          </p>
        </Panel>
      </div>

      <Panel>
        <PanelHeader
          title="Düzenli gelir ve giderler"
          subtitle="Maaş, kira, aidat, fatura gibi her ay tekrarlayan kalemler"
          action={
            <span onClick={() => setCreating(true)}>
              <AddButton label="Kalem" />
            </span>
          }
        />

        {active.length === 0 ? (
          <EmptyState
            icon={<Receipt size={28} />}
            title="Düzenli kalem yok"
            description="Maaşınızı ve kira/aidat gibi sabit giderleri girin. Nakit akışı projeksiyonu ve borç kapatma tahmini bunlara dayanır."
            action={
              <Button variant="primary" onClick={() => setCreating(true)}>
                Kalem ekle
              </Button>
            }
          />
        ) : (
          <ul>
            {active.map((item) => (
              <li
                key={item.id}
                className="flex flex-wrap items-center gap-3 border-b px-4 py-3 last:border-b-0 sm:px-5"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <p className="truncate text-sm font-medium">{item.name}</p>
                    <Badge tone={item.kind === "gelir" ? "gelir" : "nötr"}>
                      {item.kind === "gelir" ? "gelir" : "gider"}
                    </Badge>
                    {item.autoPost ? <Badge tone="brand">otomatik</Badge> : null}
                  </div>
                  <p
                    className={cn(
                      "mt-0.5 truncate text-[11px]",
                      item.daysUntil <= 2 ? "text-uyari font-medium" : "faint",
                    )}
                  >
                    {relativeDayTR(item.nextDate)} · {formatDateTR(item.nextDate)} ·{" "}
                    {item.targetLabel}
                  </p>
                </div>

                <Money
                  minor={item.kind === "gelir" ? item.amountMinor : -item.amountMinor}
                  currency={item.currency}
                  signed
                  className="text-sm font-semibold"
                />

                <div className="flex w-full justify-end gap-1 sm:w-auto">
                  <ActionButton
                    action={postRecurringAction}
                    fields={{ id: item.id }}
                    variant="secondary"
                    size="sm"
                    title="Bu dönem gerçekleşti olarak işle"
                  >
                    <Check size={13} />
                    İşle
                  </ActionButton>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(item)}>
                    <Pencil size={13} />
                  </Button>
                  <DeleteButton action={deleteRecurringAction} id={item.id} iconOnly />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {inactive.length > 0 ? (
        <Panel>
          <PanelHeader title="Pasif kalemler" subtitle={`${inactive.length} kayıt`} />
          <ul>
            {inactive.map((item) => (
              <li
                key={item.id}
                className="flex items-center gap-3 border-b px-4 py-2.5 last:border-b-0 sm:px-5"
              >
                <span className="muted min-w-0 flex-1 truncate text-sm">{item.name}</span>
                <Button size="sm" variant="ghost" onClick={() => setEditing(item)}>
                  <Pencil size={13} />
                </Button>
                <DeleteButton action={deleteRecurringAction} id={item.id} iconOnly />
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      <FormDialog
        title="Düzenli kalem"
        action={saveRecurringAction}
        open={creating}
        onOpenChange={setCreating}
      >
        <RecurringFields accounts={accounts} cards={cards} categories={categories} />
      </FormDialog>

      {editing ? (
        <FormDialog
          key={editing.id}
          title={editing.name}
          action={saveRecurringAction}
          open
          onOpenChange={(open) => !open && setEditing(null)}
        >
          <input type="hidden" name="id" value={editing.id} />
          <RecurringFields
            accounts={accounts}
            cards={cards}
            categories={categories}
            item={editing}
          />
        </FormDialog>
      ) : null}
    </div>
  );
}

function RecurringFields({
  accounts,
  cards,
  categories,
  item,
}: {
  accounts: Option[];
  cards: Option[];
  categories: Option[];
  item?: RecurringView;
}) {
  return (
    <>
      <TextField
        name="name"
        label="Ad"
        required
        defaultValue={item?.name}
        placeholder="Örn. Maaş / Kira"
      />

      <FieldRow>
        <SelectField
          name="kind"
          label="Tür"
          options={KINDS}
          defaultValue={item?.kind ?? "gelir"}
        />
        <MoneyField name="amount" label="Tutar" required defaultMinor={item?.amountMinor} />
      </FieldRow>

      <FieldRow>
        <SelectField
          name="cycle"
          label="Periyot"
          options={CYCLES}
          defaultValue={item?.cycle ?? "aylik"}
        />
        <NumberField
          name="dayOfMonth"
          label="Ayın günü"
          min={1}
          max={31}
          defaultValue={item?.dayOfMonth ?? 1}
        />
      </FieldRow>

      <FieldRow>
        <SelectField
          name="accountId"
          label="Hesap"
          options={accounts}
          placeholder="Seçiniz"
          defaultValue={item?.accountId}
        />
        <SelectField
          name="cardId"
          label="Kart"
          options={cards}
          placeholder="Kart kullanılmıyor"
          defaultValue={item?.cardId}
        />
      </FieldRow>

      <SelectField
        name="categoryId"
        label="Kategori"
        options={categories}
        placeholder="Seçiniz"
        defaultValue={item?.categoryId}
      />

      <FieldRow>
        <DateField
          name="startDate"
          label="Başlangıç"
          required
          defaultValue={item?.startDate ?? todayISO()}
        />
        <DateField
          name="nextDate"
          label="Sonraki tarih"
          required
          defaultValue={item?.nextDate ?? todayISO()}
        />
      </FieldRow>

      <FieldRow>
        <DateField name="endDate" label="Bitiş" defaultValue={item?.endDate} />
        <CurrencyField defaultValue={item?.currency ?? "TRY"} />
      </FieldRow>

      <TextField name="notes" label="Not" defaultValue={item?.notes} />

      <div className="space-y-1 border-t pt-3.5">
        <CheckboxField
          name="autoPost"
          label="Tarihi gelince otomatik hareket oluştur"
          hint="Kapalıysa listeden elle 'İşle' düğmesine basarsınız."
          defaultChecked={item?.autoPost}
        />
        <CheckboxField
          name="isArchived"
          label="Pasifleştir"
          defaultChecked={item ? !item.isActive : false}
        />
      </div>
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
