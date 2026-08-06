"use client";

import { Check, Landmark, Pencil } from "lucide-react";
import { useState } from "react";

import {
  deleteLoanAction,
  saveLoanAction,
  toggleLoanPaymentAction,
} from "@/app/actions/planning";
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
import { formatDateTR } from "@/lib/dates";
import { formatBps, formatMoney } from "@/lib/money";

export interface LoanView {
  id: number;
  name: string;
  type: string;
  institutionId: number | null;
  institutionName: string | null;
  principalMinor: number;
  currency: string;
  annualRateBps: number;
  installmentCount: number;
  monthlyPaymentMinor: number;
  firstPaymentDate: string;
  paymentAccountId: number | null;
  status: string;
  notes: string | null;
  paidCount: number;
  remainingMinor: number;
  remainingPrincipalMinor: number;
  totalInterestMinor: number;
  nextDueDate: string | null;
  payments: Array<{
    id: number;
    seq: number;
    dueDate: string;
    amountMinor: number;
    principalMinor: number;
    interestMinor: number;
    isPaid: boolean;
  }>;
}

const LOAN_TYPES: Option[] = [
  { value: "ihtiyac", label: "İhtiyaç kredisi" },
  { value: "tasit", label: "Taşıt kredisi" },
  { value: "konut", label: "Konut kredisi" },
  { value: "diger", label: "Diğer" },
];

const STATUSES: Option[] = [
  { value: "aktif", label: "Devam ediyor" },
  { value: "kapandi", label: "Kapandı" },
];

const TYPE_LABEL: Record<string, string> = Object.fromEntries(
  LOAN_TYPES.map((t) => [t.value, t.label]),
);

export function LoansClient({
  loans,
  institutions,
  accounts,
  totals,
}: {
  loans: LoanView[];
  institutions: Option[];
  accounts: Option[];
  totals: { remainingMinor: number; monthlyMinor: number };
}) {
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<LoanView | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);

  const active = loans.filter((l) => l.status === "aktif");
  const closed = loans.filter((l) => l.status !== "aktif");

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2.5 sm:gap-3">
        <Panel className="p-3 sm:p-4">
          <p className="faint text-[11px] font-medium tracking-wide uppercase">
            Kalan kredi borcu
          </p>
          <p className="tabular mt-1 text-lg font-semibold sm:text-xl">
            {formatMoney(totals.remainingMinor, "TRY", { compact: true })}
          </p>
        </Panel>
        <Panel className="p-3 sm:p-4">
          <p className="faint text-[11px] font-medium tracking-wide uppercase">
            Aylık taksit yükü
          </p>
          <p className="tabular mt-1 text-lg font-semibold sm:text-xl">
            {formatMoney(totals.monthlyMinor, "TRY", { compact: true })}
          </p>
        </Panel>
      </div>

      <Panel>
        <PanelHeader
          title="Krediler"
          subtitle="İhtiyaç, taşıt ve konut kredileri"
          action={
            <span onClick={() => setCreating(true)}>
              <AddButton label="Kredi" />
            </span>
          }
        />

        {active.length === 0 ? (
          <EmptyState
            icon={<Landmark size={28} />}
            title="Aktif kredi yok"
            description="Kredi tutarı, faiz oranı ve taksit sayısını girin; ödeme planı otomatik oluşturulur."
            action={
              <Button variant="primary" onClick={() => setCreating(true)}>
                Kredi ekle
              </Button>
            }
          />
        ) : (
          <ul>
            {active.map((loan) => (
              <li key={loan.id} className="border-b last:border-b-0">
                <div className="px-4 py-3 sm:px-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <p className="truncate text-sm font-medium">{loan.name}</p>
                        <Badge tone="nötr">{TYPE_LABEL[loan.type] ?? loan.type}</Badge>
                      </div>
                      <p className="faint mt-0.5 truncate text-[11px]">
                        {loan.institutionName ?? "Kurum yok"} ·{" "}
                        {formatMoney(loan.principalMinor, loan.currency)} anapara
                        {loan.annualRateBps > 0
                          ? ` · yıllık ${formatBps(loan.annualRateBps)}`
                          : ""}
                      </p>
                      {loan.nextDueDate ? (
                        <p className="muted mt-0.5 text-[11px]">
                          Sonraki taksit {formatDateTR(loan.nextDueDate)} ·{" "}
                          <span className="tabular font-medium">
                            {formatMoney(loan.monthlyPaymentMinor, loan.currency)}
                          </span>
                        </p>
                      ) : null}
                    </div>
                    <div className="shrink-0 text-right">
                      <Money
                        minor={loan.remainingMinor}
                        currency={loan.currency}
                        className="block text-sm font-semibold"
                      />
                      <span className="faint text-[10px]">
                        {loan.paidCount}/{loan.installmentCount} ödendi
                      </span>
                    </div>
                  </div>

                  <div className="mt-2.5">
                    <ProgressBar
                      ratio={loan.paidCount / loan.installmentCount}
                      tone="gelir"
                    />
                  </div>

                  <div className="mt-2 flex justify-end gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setExpanded(expanded === loan.id ? null : loan.id)}
                    >
                      {expanded === loan.id ? "Planı gizle" : "Ödeme planı"}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(loan)}>
                      <Pencil size={13} />
                      Düzenle
                    </Button>
                    <DeleteButton action={deleteLoanAction} id={loan.id} iconOnly />
                  </div>
                </div>

                {expanded === loan.id ? (
                  <div className="surface-2 table-scroll">
                    <table className="w-full min-w-[30rem] text-xs">
                      <thead>
                        <tr className="faint border-b text-left">
                          <th className="px-4 py-2 font-medium sm:px-5">#</th>
                          <th className="px-2 py-2 font-medium">Vade</th>
                          <th className="px-2 py-2 text-right font-medium">Taksit</th>
                          <th className="px-2 py-2 text-right font-medium">Anapara</th>
                          <th className="px-2 py-2 text-right font-medium">Faiz</th>
                          <th className="px-4 py-2 text-right font-medium sm:px-5">Durum</th>
                        </tr>
                      </thead>
                      <tbody className="tabular">
                        {loan.payments.map((p) => (
                          <tr
                            key={p.id}
                            className={cn("border-b last:border-b-0", p.isPaid && "opacity-50")}
                          >
                            <td className="px-4 py-1.5 sm:px-5">{p.seq}</td>
                            <td className="px-2 py-1.5">{formatDateTR(p.dueDate)}</td>
                            <td className="px-2 py-1.5 text-right font-medium">
                              {formatMoney(p.amountMinor, loan.currency, { showSymbol: false })}
                            </td>
                            <td className="muted px-2 py-1.5 text-right">
                              {formatMoney(p.principalMinor, loan.currency, { showSymbol: false })}
                            </td>
                            <td className="muted px-2 py-1.5 text-right">
                              {formatMoney(p.interestMinor, loan.currency, { showSymbol: false })}
                            </td>
                            <td className="px-4 py-1.5 text-right sm:px-5">
                              <ActionButton
                                action={toggleLoanPaymentAction}
                                fields={{ id: p.id }}
                                variant={p.isPaid ? "success" : "secondary"}
                                size="sm"
                                className="h-7 w-7 px-0"
                                title={p.isPaid ? "Ödenmedi işaretle" : "Ödendi işaretle"}
                              >
                                <Check size={12} />
                              </ActionButton>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {closed.length > 0 ? (
        <Panel>
          <PanelHeader title="Kapanmış krediler" subtitle={`${closed.length} kredi`} />
          <ul>
            {closed.map((loan) => (
              <li
                key={loan.id}
                className="flex items-center gap-3 border-b px-4 py-2.5 last:border-b-0 sm:px-5"
              >
                <span className="muted min-w-0 flex-1 truncate text-sm">{loan.name}</span>
                <Badge tone="gelir">kapandı</Badge>
                <DeleteButton action={deleteLoanAction} id={loan.id} iconOnly />
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      <FormDialog
        title="Yeni kredi"
        description="Taksit tutarını boş bırakırsanız anüite formülüyle hesaplanır."
        action={saveLoanAction}
        open={creating}
        onOpenChange={setCreating}
      >
        <LoanFields institutions={institutions} accounts={accounts} />
      </FormDialog>

      {editing ? (
        <FormDialog
          key={editing.id}
          title={editing.name}
          description="Ödeme planı yeniden kurulacak."
          action={saveLoanAction}
          open
          onOpenChange={(open) => !open && setEditing(null)}
        >
          <input type="hidden" name="id" value={editing.id} />
          <LoanFields institutions={institutions} accounts={accounts} loan={editing} />
        </FormDialog>
      ) : null}
    </div>
  );
}

function LoanFields({
  institutions,
  accounts,
  loan,
}: {
  institutions: Option[];
  accounts: Option[];
  loan?: LoanView;
}) {
  return (
    <>
      <TextField
        name="name"
        label="Kredi adı"
        required
        defaultValue={loan?.name}
        placeholder="Örn. Araç kredisi"
      />

      <FieldRow>
        <SelectField
          name="institutionId"
          label="Banka"
          options={institutions}
          placeholder="Seçiniz"
          defaultValue={loan?.institutionId}
        />
        <SelectField
          name="type"
          label="Kredi türü"
          options={LOAN_TYPES}
          defaultValue={loan?.type ?? "ihtiyac"}
        />
      </FieldRow>

      <FieldRow>
        <MoneyField
          name="principal"
          label="Kredi tutarı"
          required
          defaultMinor={loan?.principalMinor}
        />
        <NumberField
          name="annualRate"
          label="Yıllık faiz"
          suffix="%"
          step="0.01"
          defaultValue={loan?.annualRateBps ? loan.annualRateBps / 100 : ""}
        />
      </FieldRow>

      <FieldRow>
        <NumberField
          name="installmentCount"
          label="Taksit sayısı"
          min={1}
          max={360}
          required
          defaultValue={loan?.installmentCount}
          placeholder="36"
        />
        <MoneyField
          name="monthlyPayment"
          label="Aylık taksit"
          defaultMinor={loan?.monthlyPaymentMinor}
          hint="Boş bırakılırsa hesaplanır"
        />
      </FieldRow>

      <FieldRow>
        <DateField
          name="firstPaymentDate"
          label="İlk taksit tarihi"
          required
          defaultValue={loan?.firstPaymentDate ?? todayISO()}
        />
        <NumberField
          name="paidCount"
          label="Ödenmiş taksit"
          min={0}
          defaultValue={loan?.paidCount ?? 0}
        />
      </FieldRow>

      <FieldRow>
        <SelectField
          name="paymentAccountId"
          label="Ödeme hesabı"
          options={accounts}
          placeholder="Seçiniz"
          defaultValue={loan?.paymentAccountId}
        />
        <CurrencyField defaultValue={loan?.currency ?? "TRY"} />
      </FieldRow>

      <SelectField
        name="status"
        label="Durum"
        options={STATUSES}
        defaultValue={loan?.status ?? "aktif"}
      />

      <TextField name="notes" label="Not" defaultValue={loan?.notes} />
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
