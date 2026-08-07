"use client";

import { CreditCard, Link2, Pencil } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { deleteCardAction, saveCardAction } from "@/app/actions/entities";
import { Money } from "@/components/display";
import {
  CheckboxField,
  ColorField,
  CurrencyField,
  FieldRow,
  MoneyField,
  NumberField,
  SelectField,
  TextField,
  type Option,
} from "@/components/fields";
import { AddButton, DeleteButton, FormDialog } from "@/components/form-dialog";
import {
  Badge,
  Button,
  EmptyState,
  Panel,
  PanelHeader,
  ProgressBar,
} from "@/components/ui";
import { formatDateTR } from "@/lib/dates";
import { formatMoney, formatPercent } from "@/lib/money";

export interface CardView {
  id: number;
  name: string;
  type: string;
  currency: string;
  color: string;
  lastFour: string | null;
  network: string | null;
  institutionId: number | null;
  institutionName: string | null;
  parentCardId: number | null;
  parentCardName: string | null;
  sharesParentLimit: boolean;
  creditLimitMinor: number;
  cashAdvanceLimitMinor: number;
  statementDay: number | null;
  dueDay: number | null;
  linkedAccountId: number | null;
  linkedAccountName: string | null;
  autoPayMode: string;
  openingDebtMinor: number;
  isActive: boolean;
  notes: string | null;

  currentDueMinor: number;
  openPeriodSpendMinor: number;
  remainingInstallmentsMinor: number;
  totalDebtMinor: number;
  availableLimitMinor: number;
  utilizationRatio: number;
  nextDueDate: string | null;
  minimumDueMinor: number;
  virtualCards: Array<{ id: number; name: string; lastFour: string | null }>;
}

const CARD_TYPES: Option[] = [
  { value: "kredi", label: "Kredi kartı" },
  { value: "sanal", label: "Sanal kart" },
  { value: "banka", label: "Banka kartı" },
  { value: "onodemeli", label: "Ön ödemeli kart" },
];

const AUTO_PAY: Option[] = [
  { value: "yok", label: "Otomatik ödeme yok" },
  { value: "asgari", label: "Asgari tutar" },
  { value: "tamami", label: "Tamamı" },
];

const TYPE_LABEL: Record<string, string> = Object.fromEntries(
  CARD_TYPES.map((t) => [t.value, t.label]),
);

export function CardsClient({
  cards,
  institutions,
  accounts,
  totals,
}: {
  cards: CardView[];
  institutions: Option[];
  accounts: Option[];
  totals: { debtMinor: number; limitMinor: number; dueMinor: number };
}) {
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<CardView | null>(null);

  const active = cards.filter((c) => c.isActive);
  const archived = cards.filter((c) => !c.isActive);
  const parentOptions: Option[] = cards
    .filter((c) => c.type !== "sanal")
    .map((c) => ({ value: c.id, label: c.name }));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2.5 sm:gap-3">
        <Panel className="p-3 sm:p-4">
          <p className="faint text-[11px] font-medium tracking-wide uppercase">
            Toplam borç
          </p>
          <p className="tabular text-gider mt-1 text-base font-semibold sm:text-xl">
            {formatMoney(totals.debtMinor, "TRY", { compact: true })}
          </p>
        </Panel>
        <Panel className="p-3 sm:p-4">
          <p className="faint text-[11px] font-medium tracking-wide uppercase">
            Dönem borcu
          </p>
          <p className="tabular mt-1 text-base font-semibold sm:text-xl">
            {formatMoney(totals.dueMinor, "TRY", { compact: true })}
          </p>
        </Panel>
        <Panel className="p-3 sm:p-4">
          <p className="faint text-[11px] font-medium tracking-wide uppercase">
            Kalan limit
          </p>
          <p className="tabular mt-1 text-base font-semibold sm:text-xl">
            {formatMoney(
              Math.max(0, totals.limitMinor - totals.debtMinor),
              "TRY",
              { compact: true },
            )}
          </p>
        </Panel>
      </div>

      <Panel>
        <PanelHeader
          title="Kartlar"
          subtitle="Kredi, banka ve sanal kartlar"
          action={
            <span onClick={() => setCreating(true)}>
              <AddButton label="Kart" />
            </span>
          }
        />

        {active.length === 0 ? (
          <EmptyState
            icon={<CreditCard size={28} />}
            title="Henüz kart yok"
            description="Kredi kartınızı hesap kesim ve son ödeme günüyle birlikte ekleyin. Sanal kartlarınızı ana karta bağlayabilirsiniz."
            action={
              <Button variant="primary" onClick={() => setCreating(true)}>
                İlk kartı ekle
              </Button>
            }
          />
        ) : (
          <ul>
            {active.map((card) => (
              <li key={card.id} className="border-b px-4 py-3 last:border-b-0 sm:px-5">
                <div className="flex items-start gap-3">
                  <span
                    className="mt-0.5 flex h-10 w-14 shrink-0 items-end justify-start rounded-md p-1.5 text-[9px] font-semibold text-white/80"
                    style={{ backgroundColor: card.color }}
                    aria-hidden
                  >
                    {card.lastFour ? `••${card.lastFour}` : ""}
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Link
                        href={`/kartlar/${card.id}`}
                        className="focus-ring truncate text-sm font-medium hover:underline"
                      >
                        {card.name}
                      </Link>
                      <Badge tone={card.type === "sanal" ? "brand" : "nötr"}>
                        {TYPE_LABEL[card.type] ?? card.type}
                      </Badge>
                      {card.currency !== "TRY" ? (
                        <Badge tone="brand">{card.currency}</Badge>
                      ) : null}
                    </div>

                    <p className="faint mt-0.5 truncate text-[11px]">
                      {card.institutionName ?? "Kurum belirtilmemiş"}
                      {card.statementDay && card.dueDay
                        ? ` · kesim ${card.statementDay}, ödeme ${card.dueDay}`
                        : ""}
                      {card.parentCardName ? ` · ${card.parentCardName} kartına bağlı` : ""}
                    </p>

                    {card.nextDueDate && card.currentDueMinor > 0 ? (
                      <p className="text-uyari mt-1 text-[11px] font-medium">
                        {formatDateTR(card.nextDueDate)} tarihinde{" "}
                        {formatMoney(card.currentDueMinor, card.currency)} ödenecek
                        {card.minimumDueMinor > 0
                          ? ` (asgari ${formatMoney(card.minimumDueMinor, card.currency)})`
                          : ""}
                      </p>
                    ) : null}

                    {card.virtualCards.length > 0 ? (
                      <p className="faint mt-1 flex items-center gap-1 text-[11px]">
                        <Link2 size={11} />
                        {card.virtualCards.map((v) => v.name).join(", ")}
                      </p>
                    ) : null}
                  </div>

                  <div className="shrink-0 text-right">
                    <Money
                      minor={card.totalDebtMinor}
                      currency={card.currency}
                      className="block text-sm font-semibold"
                    />
                    <span className="para faint text-[10px]">
                      / {formatMoney(card.creditLimitMinor, card.currency, { compact: true })}
                    </span>
                  </div>
                </div>

                {card.creditLimitMinor > 0 ? (
                  <div className="mt-2.5">
                    <ProgressBar
                      ratio={card.utilizationRatio}
                      tone={
                        card.utilizationRatio > 0.9
                          ? "gider"
                          : card.utilizationRatio > 0.7
                            ? "uyari"
                            : "brand"
                      }
                    />
                    <div className="faint mt-1 flex justify-between text-[10px]">
                      <span>{formatPercent(card.utilizationRatio, 0)} dolu</span>
                      <span>
                        {formatMoney(card.availableLimitMinor, card.currency)} kullanılabilir
                      </span>
                    </div>
                  </div>
                ) : null}

                {card.remainingInstallmentsMinor > 0 ? (
                  <p className="faint mt-1.5 text-[11px]">
                    Gelecek taksitler:{" "}
                    <span className="tabular font-medium">
                      {formatMoney(card.remainingInstallmentsMinor, card.currency)}
                    </span>
                  </p>
                ) : null}

                <div className="mt-2 flex justify-end gap-1">
                  <Link href={`/kartlar/${card.id}`}>
                    <Button size="sm" variant="ghost">
                      Ekstreler
                    </Button>
                  </Link>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(card)}>
                    <Pencil size={13} />
                    Düzenle
                  </Button>
                  <DeleteButton action={deleteCardAction} id={card.id} iconOnly />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {archived.length > 0 ? (
        <Panel>
          <PanelHeader title="Arşivlenmiş kartlar" subtitle={`${archived.length} kart`} />
          <ul>
            {archived.map((card) => (
              <li
                key={card.id}
                className="flex items-center gap-3 border-b px-4 py-2.5 last:border-b-0 sm:px-5"
              >
                <span className="muted min-w-0 flex-1 truncate text-sm">{card.name}</span>
                <Button size="sm" variant="ghost" onClick={() => setEditing(card)}>
                  <Pencil size={13} />
                </Button>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      <FormDialog
        title="Yeni kart"
        description="Hesap kesim ve son ödeme günü, dönem borcunun doğru hesaplanması için zorunludur."
        action={saveCardAction}
        open={creating}
        onOpenChange={setCreating}
      >
        <CardFields
          institutions={institutions}
          accounts={accounts}
          parentOptions={parentOptions}
        />
      </FormDialog>

      {editing ? (
        <FormDialog
          key={editing.id}
          title={editing.name}
          action={saveCardAction}
          open
          onOpenChange={(open) => !open && setEditing(null)}
        >
          <input type="hidden" name="id" value={editing.id} />
          <CardFields
            institutions={institutions}
            accounts={accounts}
            parentOptions={parentOptions.filter((p) => p.value !== editing.id)}
            card={editing}
          />
        </FormDialog>
      ) : null}
    </div>
  );
}

function CardFields({
  institutions,
  accounts,
  parentOptions,
  card,
}: {
  institutions: Option[];
  accounts: Option[];
  parentOptions: Option[];
  card?: CardView;
}) {
  return (
    <>
      <TextField
        name="name"
        label="Kart adı"
        required
        defaultValue={card?.name}
        placeholder="Örn. Bonus Platinum"
      />

      <FieldRow>
        <SelectField
          name="institutionId"
          label="Banka"
          options={institutions}
          placeholder="Seçiniz"
          defaultValue={card?.institutionId}
        />
        <SelectField
          name="type"
          label="Kart türü"
          options={CARD_TYPES}
          defaultValue={card?.type ?? "kredi"}
        />
      </FieldRow>

      <FieldRow>
        <TextField
          name="lastFour"
          label="Son 4 hane"
          defaultValue={card?.lastFour}
          placeholder="1234"
          inputMode="numeric"
        />
        <TextField
          name="network"
          label="Ağ"
          defaultValue={card?.network}
          placeholder="Visa / Mastercard / Troy"
        />
      </FieldRow>

      <div className="border-t pt-3.5">
        <p className="mb-3 text-xs font-semibold">Ekstre döngüsü</p>
        <FieldRow>
          <NumberField
            name="statementDay"
            label="Hesap kesim günü"
            min={1}
            max={31}
            defaultValue={card?.statementDay}
            placeholder="15"
            hint="Ayın kaçında kesiliyor"
          />
          <NumberField
            name="dueDay"
            label="Son ödeme günü"
            min={1}
            max={31}
            defaultValue={card?.dueDay}
            placeholder="25"
            hint="Kesimden küçükse ertesi ay"
          />
        </FieldRow>
      </div>

      <div className="border-t pt-3.5">
        <p className="mb-3 text-xs font-semibold">Limitler</p>
        <FieldRow>
          <MoneyField
            name="creditLimit"
            label="Kart limiti"
            defaultMinor={card?.creditLimitMinor}
          />
          <MoneyField
            name="cashAdvanceLimit"
            label="Nakit avans limiti"
            defaultMinor={card?.cashAdvanceLimitMinor}
          />
        </FieldRow>
        <div className="mt-3.5">
          <CurrencyField defaultValue={card?.currency ?? "TRY"} />
        </div>
      </div>

      <div className="border-t pt-3.5">
        <MoneyField
          name="openingDebt"
          label="Devreden borç"
          defaultMinor={card?.openingDebtMinor}
          hint="Sisteme giriş anında ödenmemiş, hareket olarak girmeyeceğiniz eski borç. Harcamaları tek tek gireceksiniz 0 bırakın."
        />
      </div>

      <div className="border-t pt-3.5">
        <p className="mb-3 text-xs font-semibold">Sanal kart bağlantısı</p>
        <SelectField
          name="parentCardId"
          label="Ana kart"
          options={parentOptions}
          placeholder="Bağlı değil"
          defaultValue={card?.parentCardId}
          hint="Sanal kart hangi fiziksel karta bağlı?"
        />
        <div className="mt-2">
          <CheckboxField
            name="sharesParentLimit"
            label="Ana kartın limitini paylaşıyor"
            hint="Sanal kartın kendi alt limiti varsa işaretlemeyin."
            defaultChecked={card?.sharesParentLimit ?? true}
          />
        </div>
      </div>

      <div className="border-t pt-3.5">
        <p className="mb-3 text-xs font-semibold">Ödeme</p>
        <FieldRow>
          <SelectField
            name="linkedAccountId"
            label="Ödeme hesabı"
            options={accounts}
            placeholder="Seçiniz"
            defaultValue={card?.linkedAccountId}
          />
          <SelectField
            name="autoPayMode"
            label="Otomatik ödeme"
            options={AUTO_PAY}
            defaultValue={card?.autoPayMode ?? "yok"}
          />
        </FieldRow>
      </div>

      <div className="border-t pt-3.5">
        <ColorField defaultValue={card?.color ?? "#8b5cf6"} />
      </div>

      <TextField name="notes" label="Not" defaultValue={card?.notes} />

      <div className="border-t pt-3.5">
        <CheckboxField
          name="isArchived"
          label="Arşivle"
          hint="Kapatılmış kartlar listede alta düşer."
          defaultChecked={card ? !card.isActive : false}
        />
      </div>
    </>
  );
}
