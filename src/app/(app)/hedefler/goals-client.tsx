"use client";

import { Pencil, PiggyBank } from "lucide-react";
import { useState } from "react";

import { deleteGoalAction, saveGoalAction } from "@/app/actions/planning";
import { Money } from "@/components/display";
import {
  CheckboxField,
  ColorField,
  CurrencyField,
  DateField,
  FieldRow,
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
import { formatDateTR } from "@/lib/dates";
import { formatMoney, formatPercent } from "@/lib/money";

export interface GoalView {
  id: number;
  name: string;
  targetMinor: number;
  currency: string;
  targetDate: string | null;
  accountId: number | null;
  accountName: string | null;
  manualSavedMinor: number;
  isActive: boolean;
  color: string;
  notes: string | null;
  savedMinor: number;
  savedTRYMinor: number;
  remainingMinor: number;
  ratio: number;
  monthsAtCurrentRate: number | null;
  monthsToTarget: number | null;
  daysToTarget: number | null;
  requiredMonthlyMinor: number | null;
}

export function GoalsClient({
  goals,
  accounts,
  avgMonthlySavingMinor,
}: {
  goals: GoalView[];
  accounts: Option[];
  avgMonthlySavingMinor: number;
}) {
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<GoalView | null>(null);

  const active = goals.filter((g) => g.isActive);

  return (
    <div className="space-y-4">
      <Panel className="p-3 sm:p-4">
        <p className="faint text-[11px] font-medium tracking-wide uppercase">
          Aylık ortalama birikim kapasiteniz
        </p>
        <p
          className={`tabular mt-1 text-lg font-semibold sm:text-xl ${avgMonthlySavingMinor >= 0 ? "text-gelir" : "text-gider"}`}
        >
          {formatMoney(avgMonthlySavingMinor, "TRY", { signed: true })}
        </p>
        <p className="muted mt-0.5 text-[11px]">
          Son aylardaki gelir − gider ortalaması. Hedeflere kalan süre buna göre
          tahmin edilir.
        </p>
      </Panel>

      <Panel>
        <PanelHeader
          title="Birikim hedefleri"
          subtitle="Bir hesaba bağlarsanız ilerleme kendiliğinden güncellenir"
          action={
            <span onClick={() => setCreating(true)}>
              <AddButton label="Hedef" />
            </span>
          }
        />

        {active.length === 0 ? (
          <EmptyState
            icon={<PiggyBank size={28} />}
            title="Hedef tanımlı değil"
            description="Acil durum fonu, tatil, araç peşinatı gibi hedefler koyun; ne zaman ulaşacağınızı görün."
            action={
              <Button variant="primary" onClick={() => setCreating(true)}>
                Hedef ekle
              </Button>
            }
          />
        ) : (
          <ul>
            {active.map((goal) => (
              <li key={goal.id} className="border-b px-4 py-3 last:border-b-0 sm:px-5">
                <div className="flex items-start gap-3">
                  <span
                    className="mt-0.5 h-9 w-9 shrink-0 rounded-lg"
                    style={{ backgroundColor: goal.color }}
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="truncate text-sm font-medium">{goal.name}</p>
                      {goal.ratio >= 1 ? <Badge tone="gelir">tamamlandı</Badge> : null}
                    </div>
                    <p className="faint mt-0.5 truncate text-[11px]">
                      {goal.accountName
                        ? `${goal.accountName} hesabına bağlı`
                        : "elle takip ediliyor"}
                      {goal.targetDate ? ` · hedef ${formatDateTR(goal.targetDate)}` : ""}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <Money
                      minor={goal.savedTRYMinor}
                      className="block text-sm font-semibold"
                    />
                    <span className="faint text-[10px]">
                      / {formatMoney(goal.targetMinor, goal.currency, { compact: true })}
                    </span>
                  </div>
                </div>

                <div className="mt-2.5">
                  <ProgressBar ratio={goal.ratio} tone="gelir" showOverflow={false} />
                </div>

                <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
                  <span className="faint text-[11px]">
                    {formatPercent(goal.ratio, 0)} tamamlandı
                    {goal.remainingMinor > 0
                      ? ` · ${formatMoney(goal.remainingMinor)} kaldı`
                      : ""}
                    {goal.monthsAtCurrentRate != null && goal.monthsAtCurrentRate > 0
                      ? ` · bu tempoyla ${goal.monthsAtCurrentRate} ay`
                      : ""}
                  </span>
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(goal)}>
                      <Pencil size={13} />
                    </Button>
                    <DeleteButton action={deleteGoalAction} id={goal.id} iconOnly />
                  </div>
                </div>

                {goal.requiredMonthlyMinor != null && goal.remainingMinor > 0 ? (
                  <p
                    className={`mt-1 text-[11px] ${
                      goal.requiredMonthlyMinor > avgMonthlySavingMinor
                        ? "text-uyari"
                        : "text-gelir"
                    }`}
                  >
                    Hedef tarihe yetişmek için ayda{" "}
                    <strong>{formatMoney(goal.requiredMonthlyMinor)}</strong> ayırmalısınız
                    {goal.requiredMonthlyMinor > avgMonthlySavingMinor
                      ? " — mevcut kapasitenizin üzerinde."
                      : "."}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <FormDialog
        title="Yeni hedef"
        action={saveGoalAction}
        open={creating}
        onOpenChange={setCreating}
      >
        <GoalFields accounts={accounts} />
      </FormDialog>

      {editing ? (
        <FormDialog
          key={editing.id}
          title={editing.name}
          action={saveGoalAction}
          open
          onOpenChange={(open) => !open && setEditing(null)}
        >
          <input type="hidden" name="id" value={editing.id} />
          <GoalFields accounts={accounts} goal={editing} />
        </FormDialog>
      ) : null}
    </div>
  );
}

function GoalFields({ accounts, goal }: { accounts: Option[]; goal?: GoalView }) {
  return (
    <>
      <TextField
        name="name"
        label="Hedef adı"
        required
        defaultValue={goal?.name}
        placeholder="Örn. Acil durum fonu"
      />
      <FieldRow>
        <MoneyField
          name="target"
          label="Hedef tutar"
          required
          defaultMinor={goal?.targetMinor}
        />
        <DateField name="targetDate" label="Hedef tarih" defaultValue={goal?.targetDate} />
      </FieldRow>
      <SelectField
        name="accountId"
        label="Bağlı hesap"
        options={accounts}
        placeholder="Elle takip et"
        defaultValue={goal?.accountId}
        hint="Hesap seçerseniz ilerleme bakiyeden okunur."
      />
      <FieldRow>
        <MoneyField
          name="manualSaved"
          label="Biriken (elle)"
          defaultMinor={goal?.manualSavedMinor}
        />
        <CurrencyField defaultValue={goal?.currency ?? "TRY"} />
      </FieldRow>
      <ColorField defaultValue={goal?.color ?? "#10b981"} />
      <TextField name="notes" label="Not" defaultValue={goal?.notes} />
      <div className="border-t pt-3.5">
        <CheckboxField
          name="isArchived"
          label="Arşivle"
          defaultChecked={goal ? !goal.isActive : false}
        />
      </div>
    </>
  );
}
