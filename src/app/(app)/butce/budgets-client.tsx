"use client";

import { Target } from "lucide-react";
import { useState } from "react";

import { deleteBudgetAction, saveBudgetAction } from "@/app/actions/planning";
import { Money } from "@/components/display";
import {
  CurrencyField,
  MoneyField,
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
import { formatMonthTR } from "@/lib/dates";
import { formatMoney, formatPercent } from "@/lib/money";

export interface BudgetView {
  id: number;
  categoryId: number;
  name: string;
  month: string | null;
  amountMinor: number;
  currency: string;
  spentMinor: number;
  remainingMinor: number;
  ratio: number;
  isOver: boolean;
}

export function BudgetsClient({
  budgets,
  categories,
  month,
}: {
  budgets: BudgetView[];
  categories: Option[];
  month: string;
}) {
  const [creating, setCreating] = useState(false);

  const totalBudget = budgets.reduce((s, b) => s + b.amountMinor, 0);
  const totalSpent = budgets.reduce((s, b) => s + b.spentMinor, 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2.5 sm:gap-3">
        <Panel className="p-3 sm:p-4">
          <p className="faint text-[11px] font-medium tracking-wide uppercase">Bütçe</p>
          <p className="tabular mt-1 text-base font-semibold sm:text-lg">
            {formatMoney(totalBudget, "TRY", { compact: true })}
          </p>
        </Panel>
        <Panel className="p-3 sm:p-4">
          <p className="faint text-[11px] font-medium tracking-wide uppercase">
            Harcanan
          </p>
          <p className="tabular mt-1 text-base font-semibold sm:text-lg">
            {formatMoney(totalSpent, "TRY", { compact: true })}
          </p>
        </Panel>
        <Panel className="p-3 sm:p-4">
          <p className="faint text-[11px] font-medium tracking-wide uppercase">Kalan</p>
          <p
            className={`tabular mt-1 text-base font-semibold sm:text-lg ${totalBudget - totalSpent < 0 ? "text-gider" : "text-gelir"}`}
          >
            {formatMoney(totalBudget - totalSpent, "TRY", { compact: true })}
          </p>
        </Panel>
      </div>

      <Panel>
        <PanelHeader
          title="Kategori bütçeleri"
          subtitle={`${formatMonthTR(month)} · üst kategoriye konan bütçe alt kategorileri de kapsar`}
          action={
            <span onClick={() => setCreating(true)}>
              <AddButton label="Bütçe" />
            </span>
          }
        />

        {budgets.length === 0 ? (
          <EmptyState
            icon={<Target size={28} />}
            title="Bütçe tanımlı değil"
            description="Market, yeme-içme gibi kategorilere aylık sınır koyun; aşınca uyarı alırsınız."
            action={
              <Button variant="primary" onClick={() => setCreating(true)}>
                Bütçe ekle
              </Button>
            }
          />
        ) : (
          <ul>
            {budgets.map((b) => (
              <li key={b.id} className="border-b px-4 py-3 last:border-b-0 sm:px-5">
                <div className="mb-1.5 flex items-baseline justify-between gap-3">
                  <span className="flex items-center gap-1.5 truncate text-sm font-medium">
                    {b.name}
                    {b.month == null ? <Badge tone="nötr">her ay</Badge> : null}
                    {b.isOver ? <Badge tone="gider">aşıldı</Badge> : null}
                  </span>
                  <span className="tabular shrink-0 text-xs">
                    <span className={b.isOver ? "text-gider font-semibold" : "font-semibold"}>
                      {formatMoney(b.spentMinor, "TRY", { showSymbol: false })}
                    </span>
                    <span className="faint"> / {formatMoney(b.amountMinor)}</span>
                  </span>
                </div>
                <ProgressBar ratio={b.ratio} tone={b.isOver ? "gider" : "gelir"} />
                <div className="mt-1.5 flex items-center justify-between">
                  <span className="faint text-[11px]">
                    {formatPercent(b.ratio, 0)} kullanıldı ·{" "}
                    {b.remainingMinor >= 0
                      ? `${formatMoney(b.remainingMinor)} kaldı`
                      : `${formatMoney(-b.remainingMinor)} aşım`}
                  </span>
                  <DeleteButton action={deleteBudgetAction} id={b.id} iconOnly />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <FormDialog
        title="Yeni bütçe"
        description="Ay alanını boş bırakırsanız bütçe her ay geçerli olur."
        action={saveBudgetAction}
        open={creating}
        onOpenChange={setCreating}
      >
        <SelectField
          name="categoryId"
          label="Kategori"
          options={categories}
          placeholder="Seçiniz"
          required
        />
        <MoneyField name="amount" label="Aylık sınır" required />
        <TextField
          name="month"
          label="Ay"
          placeholder="YYYY-AA (boş: her ay)"
          hint="Örn. 2026-08"
        />
        <CurrencyField />
      </FormDialog>
    </div>
  );
}
