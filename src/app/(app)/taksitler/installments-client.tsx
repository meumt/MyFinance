"use client";

import { Check, ListChecks, Pencil } from "lucide-react";
import { useState } from "react";

import {
  deletePlanAction,
  savePlanAction,
  toggleInstallmentAction,
} from "@/app/actions/installments";
import { InstallmentLoadChart } from "@/components/charts";
import { Money } from "@/components/display";
import {
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
import {
  Badge,
  Button,
  EmptyState,
  Panel,
  PanelHeader,
  ProgressBar,
  cn,
} from "@/components/ui";
import { formatDateTR, formatMonthTR } from "@/lib/dates";
import { formatMoney } from "@/lib/money";

export interface PlanView {
  id: number;
  cardId: number;
  cardName: string;
  cardColor: string;
  description: string;
  purchaseDate: string;
  totalAmountMinor: number;
  currency: string;
  installmentCount: number;
  paidCount: number;
  categoryId: number | null;
  merchantName: string | null;
  notes: string | null;
  status: string;
  remainingMinor: number;
  monthlyMinor: number;
  nextDueDate: string | null;
  lastDueDate: string | null;
  installments: Array<{
    id: number;
    seq: number;
    amountMinor: number;
    dueDate: string;
    isPaid: boolean;
  }>;
}

export function InstallmentsClient({
  plans,
  cards,
  categories,
  loadByMonth,
  totals,
}: {
  plans: PlanView[];
  cards: Option[];
  categories: Option[];
  loadByMonth: Array<{
    month: string;
    totalMinor: number;
    byCard: Array<{ cardId: number; cardName: string; amountMinor: number }>;
  }>;
  totals: { remainingMinor: number; thisMonthMinor: number; activePlans: number };
}) {
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<PlanView | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);

  const active = plans.filter((p) => p.status === "aktif");
  const completed = plans.filter((p) => p.status !== "aktif");
  const lastDue = active.reduce<string | null>(
    (acc, p) => (p.lastDueDate && (!acc || p.lastDueDate > acc) ? p.lastDueDate : acc),
    null,
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2.5 sm:gap-3">
        <Panel className="p-3 sm:p-4">
          <p className="faint text-[11px] font-medium tracking-wide uppercase">
            Kalan taksit yükü
          </p>
          <p className="tabular mt-1 text-base font-semibold sm:text-xl">
            {formatMoney(totals.remainingMinor, "TRY", { compact: true })}
          </p>
        </Panel>
        <Panel className="p-3 sm:p-4">
          <p className="faint text-[11px] font-medium tracking-wide uppercase">
            Bu ay ödenecek
          </p>
          <p className="tabular mt-1 text-base font-semibold sm:text-xl">
            {formatMoney(totals.thisMonthMinor, "TRY", { compact: true })}
          </p>
        </Panel>
        <Panel className="p-3 sm:p-4">
          <p className="faint text-[11px] font-medium tracking-wide uppercase">
            Son taksit
          </p>
          <p className="mt-1 text-sm font-semibold sm:text-base">
            {lastDue ? formatMonthTR(lastDue.slice(0, 7)) : "—"}
          </p>
        </Panel>
      </div>

      {loadByMonth.some((l) => l.totalMinor > 0) ? (
        <Panel>
          <PanelHeader
            title="Aylara göre taksit yükü"
            subtitle="Önümüzdeki 18 ay — sabit ödemeleriniz"
          />
          <div className="p-3 sm:p-4">
            <InstallmentLoadChart data={loadByMonth} />
          </div>
        </Panel>
      ) : null}

      <Panel>
        <PanelHeader
          title="Taksitli alışverişler"
          subtitle={`${active.length} aktif plan`}
          action={
            <span onClick={() => setCreating(true)}>
              <AddButton label="Taksit" />
            </span>
          }
        />

        {active.length === 0 ? (
          <EmptyState
            icon={<ListChecks size={28} />}
            title="Aktif taksitli alışveriş yok"
            description="Devam eden taksitlerinizi girin. Ödenmiş taksit sayısını belirtmeniz yeterli — kalan takvimi sistem kurar."
            action={
              <Button variant="primary" onClick={() => setCreating(true)}>
                Taksit planı ekle
              </Button>
            }
          />
        ) : (
          <ul>
            {active.map((plan) => (
              <li key={plan.id} className="border-b last:border-b-0">
                <div className="px-4 py-3 sm:px-5">
                  <div className="flex items-start gap-3">
                    <span
                      className="mt-0.5 h-9 w-9 shrink-0 rounded-lg"
                      style={{ backgroundColor: plan.cardColor }}
                      aria-hidden
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{plan.description}</p>
                      <p className="faint mt-0.5 truncate text-[11px]">
                        {plan.cardName} · {formatDateTR(plan.purchaseDate)} ·{" "}
                        {formatMoney(plan.totalAmountMinor, plan.currency)} toplam
                      </p>
                      {plan.nextDueDate ? (
                        <p className="muted mt-0.5 text-[11px]">
                          Sonraki taksit {formatMonthTR(plan.nextDueDate.slice(0, 7))} ·{" "}
                          <span className="tabular font-medium">
                            {formatMoney(plan.monthlyMinor, plan.currency)}
                          </span>
                        </p>
                      ) : null}
                    </div>
                    <div className="shrink-0 text-right">
                      <Money
                        minor={plan.remainingMinor}
                        currency={plan.currency}
                        className="block text-sm font-semibold"
                      />
                      <span className="faint text-[10px]">
                        {plan.paidCount}/{plan.installmentCount} ödendi
                      </span>
                    </div>
                  </div>

                  <div className="mt-2.5">
                    <ProgressBar
                      ratio={plan.paidCount / plan.installmentCount}
                      tone="gelir"
                    />
                  </div>

                  <div className="mt-2 flex justify-end gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setExpanded(expanded === plan.id ? null : plan.id)}
                    >
                      {expanded === plan.id ? "Takvimi gizle" : "Takvim"}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(plan)}>
                      <Pencil size={13} />
                      Düzenle
                    </Button>
                    <DeleteButton action={deletePlanAction} id={plan.id} iconOnly />
                  </div>
                </div>

                {expanded === plan.id ? (
                  <div className="surface-2 px-4 pt-1 pb-3 sm:px-5">
                    <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                      {plan.installments.map((inst) => (
                        <div
                          key={inst.id}
                          className={cn(
                            "surface flex items-center justify-between gap-2 rounded-lg px-2.5 py-2",
                            inst.isPaid && "opacity-60",
                          )}
                        >
                          <div className="min-w-0">
                            <p className="faint text-[10px]">
                              {inst.seq}. taksit
                            </p>
                            <p className="tabular truncate text-xs font-medium">
                              {formatMoney(inst.amountMinor, plan.currency, {
                                showSymbol: false,
                              })}
                            </p>
                            <p className="faint text-[10px]">
                              {formatMonthTR(inst.dueDate.slice(0, 7))}
                            </p>
                          </div>
                          <ActionButton
                            action={toggleInstallmentAction}
                            fields={{ id: inst.id }}
                            variant={inst.isPaid ? "success" : "secondary"}
                            size="sm"
                            className="h-7 w-7 shrink-0 px-0"
                            title={inst.isPaid ? "Ödenmedi işaretle" : "Ödendi işaretle"}
                          >
                            <Check size={13} />
                          </ActionButton>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {completed.length > 0 ? (
        <Panel>
          <PanelHeader title="Tamamlanan planlar" subtitle={`${completed.length} plan`} />
          <ul>
            {completed.map((plan) => (
              <li
                key={plan.id}
                className="flex items-center gap-3 border-b px-4 py-2.5 last:border-b-0 sm:px-5"
              >
                <div className="min-w-0 flex-1">
                  <p className="muted truncate text-sm">{plan.description}</p>
                  <p className="faint text-[11px]">
                    {plan.cardName} · {plan.installmentCount} taksit tamamlandı
                  </p>
                </div>
                <Badge tone="gelir">bitti</Badge>
                <DeleteButton action={deletePlanAction} id={plan.id} iconOnly />
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      <FormDialog
        title="Taksitli alışveriş"
        description="Devam eden bir alışverişi girerken ödenmiş taksit sayısını da belirtin."
        action={savePlanAction}
        open={creating}
        onOpenChange={setCreating}
      >
        <PlanFields cards={cards} categories={categories} />
      </FormDialog>

      {editing ? (
        <FormDialog
          key={editing.id}
          title={editing.description}
          description="Takvim yeniden kurulacak; ödendi işaretleri sıfırlanır."
          action={savePlanAction}
          open
          onOpenChange={(open) => !open && setEditing(null)}
        >
          <input type="hidden" name="id" value={editing.id} />
          <PlanFields cards={cards} categories={categories} plan={editing} />
        </FormDialog>
      ) : null}
    </div>
  );
}

function PlanFields({
  cards,
  categories,
  plan,
}: {
  cards: Option[];
  categories: Option[];
  plan?: PlanView;
}) {
  return (
    <>
      <TextField
        name="description"
        label="Ne aldınız?"
        required
        defaultValue={plan?.description}
        placeholder="Örn. Buzdolabı"
      />

      <SelectField
        name="cardId"
        label="Kart"
        options={cards}
        placeholder="Seçiniz"
        required
        defaultValue={plan?.cardId}
        hint="Taksitler bu kartın ekstre dönemlerine dağıtılır."
      />

      <FieldRow>
        <MoneyField
          name="totalAmount"
          label="Toplam tutar"
          required
          defaultMinor={plan?.totalAmountMinor}
        />
        <NumberField
          name="installmentCount"
          label="Taksit sayısı"
          min={1}
          max={60}
          required
          defaultValue={plan?.installmentCount}
          placeholder="12"
        />
      </FieldRow>

      <FieldRow>
        <DateField
          name="purchaseDate"
          label="Alışveriş tarihi"
          required
          defaultValue={plan?.purchaseDate ?? todayISO()}
        />
        <NumberField
          name="paidCount"
          label="Ödenmiş taksit"
          min={0}
          defaultValue={plan?.paidCount ?? 0}
          hint="Devam eden alışveriş için"
        />
      </FieldRow>

      <TextField
        name="merchantName"
        label="İşyeri"
        defaultValue={plan?.merchantName}
        placeholder="Örn. Vestel"
      />

      <FieldRow>
        <SelectField
          name="categoryId"
          label="Kategori"
          options={categories}
          placeholder="Seçiniz"
          defaultValue={plan?.categoryId}
        />
        <CurrencyField defaultValue={plan?.currency ?? "TRY"} />
      </FieldRow>

      <TextField name="notes" label="Not" defaultValue={plan?.notes} />
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
