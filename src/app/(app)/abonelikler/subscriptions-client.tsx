"use client";

import { Check, Pencil, Repeat } from "lucide-react";
import { useState } from "react";

import {
  deleteSubscriptionAction,
  markSubscriptionChargedAction,
  saveSubscriptionAction,
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

export interface SubscriptionView {
  id: number;
  name: string;
  amountMinor: number;
  currency: string;
  cycle: string;
  cycleDays: number | null;
  startDate: string;
  nextRenewalDate: string;
  endDate: string | null;
  lastChargedDate: string | null;
  paymentCardId: number | null;
  paymentAccountId: number | null;
  paymentLabel: string;
  categoryId: number | null;
  autoRenew: boolean;
  reminderDaysBefore: number;
  isActive: boolean;
  notes: string | null;
  monthlyEquivalentMinor: number;
  daysUntil: number;
  limitWarning: boolean;
}

const CYCLES: Option[] = [
  { value: "aylik", label: "Aylık" },
  { value: "yillik", label: "Yıllık" },
  { value: "uc_aylik", label: "3 aylık" },
  { value: "alti_aylik", label: "6 aylık" },
  { value: "haftalik", label: "Haftalık" },
  { value: "ozel", label: "Özel (gün)" },
];

const CYCLE_LABEL: Record<string, string> = Object.fromEntries(
  CYCLES.map((c) => [c.value, c.label]),
);

export function SubscriptionsClient({
  subscriptions,
  cards,
  accounts,
  categories,
  totals,
}: {
  subscriptions: SubscriptionView[];
  cards: Option[];
  accounts: Option[];
  categories: Option[];
  totals: { monthlyMinor: number; yearlyMinor: number };
}) {
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<SubscriptionView | null>(null);

  const active = subscriptions.filter((s) => s.isActive);
  const inactive = subscriptions.filter((s) => !s.isActive);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2.5 sm:gap-3">
        <Panel className="p-3 sm:p-4">
          <p className="faint text-[11px] font-medium tracking-wide uppercase">
            Aylık toplam
          </p>
          <p className="tabular mt-1 text-lg font-semibold sm:text-xl">
            {formatMoney(totals.monthlyMinor)}
          </p>
          <p className="muted mt-0.5 text-[11px]">{active.length} aktif abonelik</p>
        </Panel>
        <Panel className="p-3 sm:p-4">
          <p className="faint text-[11px] font-medium tracking-wide uppercase">
            Yıllık maliyet
          </p>
          <p className="tabular mt-1 text-lg font-semibold sm:text-xl">
            {formatMoney(totals.yearlyMinor)}
          </p>
          <p className="muted mt-0.5 text-[11px]">12 aylık projeksiyon</p>
        </Panel>
      </div>

      <Panel>
        <PanelHeader
          title="Abonelikler"
          subtitle="Düzenli yenilenen ödemeler"
          action={
            <span onClick={() => setCreating(true)}>
              <AddButton label="Abonelik" />
            </span>
          }
        />

        {active.length === 0 ? (
          <EmptyState
            icon={<Repeat size={28} />}
            title="Abonelik yok"
            description="Netflix, Spotify, telefon paketi, sigorta gibi düzenli ödemeleri girin. Yenileme yaklaşınca bildirim alırsınız."
            action={
              <Button variant="primary" onClick={() => setCreating(true)}>
                Abonelik ekle
              </Button>
            }
          />
        ) : (
          <ul>
            {active.map((sub) => (
              <li
                key={sub.id}
                className="flex flex-wrap items-center gap-3 border-b px-4 py-3 last:border-b-0 sm:px-5"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <p className="truncate text-sm font-medium">{sub.name}</p>
                    <Badge tone="nötr">{CYCLE_LABEL[sub.cycle] ?? sub.cycle}</Badge>
                    {sub.limitWarning ? <Badge tone="gider">limit yetersiz</Badge> : null}
                    {!sub.autoRenew ? <Badge tone="uyari">otomatik değil</Badge> : null}
                  </div>
                  <p
                    className={cn(
                      "mt-0.5 truncate text-[11px]",
                      sub.daysUntil <= 2 ? "text-uyari font-medium" : "faint",
                    )}
                  >
                    {relativeDayTR(sub.nextRenewalDate)} yenilenecek ·{" "}
                    {formatDateTR(sub.nextRenewalDate)} · {sub.paymentLabel}
                  </p>
                </div>

                <div className="text-right">
                  <Money
                    minor={sub.amountMinor}
                    currency={sub.currency}
                    className="block text-sm font-semibold"
                  />
                  {sub.cycle !== "aylik" ? (
                    <span className="para faint text-[10px]">
                      aylık {formatMoney(sub.monthlyEquivalentMinor)}
                    </span>
                  ) : null}
                </div>

                <div className="flex w-full justify-end gap-1 sm:w-auto">
                  <ActionButton
                    action={markSubscriptionChargedAction}
                    fields={{ id: sub.id }}
                    variant="secondary"
                    size="sm"
                    title="Bu yenileme çekildi olarak işaretle"
                  >
                    <Check size={13} />
                    Çekildi
                  </ActionButton>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(sub)}>
                    <Pencil size={13} />
                  </Button>
                  <DeleteButton action={deleteSubscriptionAction} id={sub.id} iconOnly />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {inactive.length > 0 ? (
        <Panel>
          <PanelHeader title="İptal edilmiş" subtitle={`${inactive.length} abonelik`} />
          <ul>
            {inactive.map((sub) => (
              <li
                key={sub.id}
                className="flex items-center gap-3 border-b px-4 py-2.5 last:border-b-0 sm:px-5"
              >
                <span className="muted min-w-0 flex-1 truncate text-sm">{sub.name}</span>
                <Money
                  minor={sub.amountMinor}
                  currency={sub.currency}
                  className="muted text-xs"
                />
                <Button size="sm" variant="ghost" onClick={() => setEditing(sub)}>
                  <Pencil size={13} />
                </Button>
                <DeleteButton action={deleteSubscriptionAction} id={sub.id} iconOnly />
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      <FormDialog
        title="Yeni abonelik"
        action={saveSubscriptionAction}
        open={creating}
        onOpenChange={setCreating}
      >
        <SubscriptionFields cards={cards} accounts={accounts} categories={categories} />
      </FormDialog>

      {editing ? (
        <FormDialog
          key={editing.id}
          title={editing.name}
          action={saveSubscriptionAction}
          open
          onOpenChange={(open) => !open && setEditing(null)}
        >
          <input type="hidden" name="id" value={editing.id} />
          <SubscriptionFields
            cards={cards}
            accounts={accounts}
            categories={categories}
            sub={editing}
          />
        </FormDialog>
      ) : null}
    </div>
  );
}

function SubscriptionFields({
  cards,
  accounts,
  categories,
  sub,
}: {
  cards: Option[];
  accounts: Option[];
  categories: Option[];
  sub?: SubscriptionView;
}) {
  return (
    <>
      <TextField
        name="name"
        label="Abonelik adı"
        required
        defaultValue={sub?.name}
        placeholder="Örn. Netflix"
      />

      <FieldRow>
        <MoneyField
          name="amount"
          label="Tutar"
          required
          defaultMinor={sub?.amountMinor}
        />
        <SelectField
          name="cycle"
          label="Periyot"
          options={CYCLES}
          defaultValue={sub?.cycle ?? "aylik"}
        />
      </FieldRow>

      <FieldRow>
        <NumberField
          name="cycleDays"
          label="Özel periyot (gün)"
          min={1}
          defaultValue={sub?.cycleDays}
          hint="Sadece 'Özel' seçilirse"
        />
        <CurrencyField defaultValue={sub?.currency ?? "TRY"} />
      </FieldRow>

      <FieldRow>
        <DateField
          name="startDate"
          label="Başlangıç"
          required
          defaultValue={sub?.startDate ?? todayISO()}
        />
        <DateField
          name="nextRenewalDate"
          label="Sonraki yenileme"
          required
          defaultValue={sub?.nextRenewalDate ?? todayISO()}
        />
      </FieldRow>

      <div className="border-t pt-3.5">
        <p className="mb-3 text-xs font-semibold">Ödeme yöntemi</p>
        <FieldRow>
          <SelectField
            name="paymentCardId"
            label="Kart"
            options={cards}
            placeholder="Kart kullanılmıyor"
            defaultValue={sub?.paymentCardId}
          />
          <SelectField
            name="paymentAccountId"
            label="Hesap"
            options={accounts}
            placeholder="Hesap kullanılmıyor"
            defaultValue={sub?.paymentAccountId}
          />
        </FieldRow>
        <p className="faint mt-1.5 text-[11px]">
          Kart seçilirse hesap yok sayılır.
        </p>
      </div>

      <SelectField
        name="categoryId"
        label="Kategori"
        options={categories}
        placeholder="Seçiniz"
        defaultValue={sub?.categoryId}
      />

      <FieldRow>
        <NumberField
          name="reminderDaysBefore"
          label="Kaç gün önce uyar"
          min={0}
          max={30}
          defaultValue={sub?.reminderDaysBefore ?? 2}
        />
        <DateField name="endDate" label="Bitiş tarihi" defaultValue={sub?.endDate} />
      </FieldRow>

      <TextField name="notes" label="Not" defaultValue={sub?.notes} />

      <div className="space-y-1 border-t pt-3.5">
        <CheckboxField
          name="autoRenew"
          label="Otomatik yenileniyor"
          defaultChecked={sub?.autoRenew ?? true}
        />
        <CheckboxField
          name="isArchived"
          label="İptal edildi"
          defaultChecked={sub ? !sub.isActive : false}
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
