"use client";

import { Landmark, Pencil, Scale, Wallet } from "lucide-react";
import { useState } from "react";

import {
  deleteAccountAction,
  saveAccountAction,
  saveBalanceSnapshotAction,
} from "@/app/actions/entities";
import {
  CheckboxField,
  ColorField,
  CurrencyField,
  DateField,
  FieldRow,
  MoneyField,
  NumberField,
  SelectField,
  TextField,
  type Option,
} from "@/components/fields";
import { AddButton, DeleteButton, FormDialog } from "@/components/form-dialog";
import { Money } from "@/components/display";
import {
  Badge,
  Button,
  EmptyState,
  Panel,
  PanelHeader,
  ProgressBar,
} from "@/components/ui";
import { formatBps, formatMoney } from "@/lib/money";
import { formatDateTR } from "@/lib/dates";

export interface AccountView {
  id: number;
  name: string;
  type: string;
  currency: string;
  color: string;
  iban: string | null;
  institutionId: number | null;
  institutionName: string | null;
  openingBalanceMinor: number;
  openingDate: string;
  overdraftLimitMinor: number;
  overdraftRateBps: number;
  interestRateBps: number;
  maturityDate: string | null;
  isActive: boolean;
  excludeFromNetWorth: boolean;
  notes: string | null;

  balanceMinor: number;
  overdraftUsedMinor: number;
  overdraftAvailableMinor: number;
  spendableMinor: number;
  balanceTRYMinor: number;
  lastSnapshotDate: string | null;
}

const ACCOUNT_TYPES: Option[] = [
  { value: "vadesiz", label: "Vadesiz hesap" },
  { value: "birikim", label: "Birikim hesabı" },
  { value: "vadeli", label: "Vadeli mevduat" },
  { value: "nakit", label: "Nakit / cüzdan" },
  { value: "yatirim", label: "Yatırım hesabı" },
];

const TYPE_LABEL: Record<string, string> = Object.fromEntries(
  ACCOUNT_TYPES.map((t) => [t.value, t.label]),
);

export function AccountsClient({
  accounts,
  institutions,
  totalTRYMinor,
  totalOverdraftMinor,
}: {
  accounts: AccountView[];
  institutions: Option[];
  totalTRYMinor: number;
  totalOverdraftMinor: number;
}) {
  const [editing, setEditing] = useState<AccountView | null>(null);
  const [creating, setCreating] = useState(false);
  const [reconciling, setReconciling] = useState<AccountView | null>(null);

  const active = accounts.filter((a) => a.isActive);
  const archived = accounts.filter((a) => !a.isActive);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2.5 sm:gap-3">
        <Panel className="p-3 sm:p-4">
          <p className="faint text-[11px] font-medium tracking-wide uppercase">
            Toplam varlık
          </p>
          <p className="tabular mt-1 text-lg font-semibold sm:text-xl">
            {formatMoney(totalTRYMinor)}
          </p>
          <p className="muted mt-0.5 text-[11px]">{active.length} aktif hesap</p>
        </Panel>
        <Panel className="p-3 sm:p-4">
          <p className="faint text-[11px] font-medium tracking-wide uppercase">
            Ek hesap kullanımı
          </p>
          <p
            className={`tabular mt-1 text-lg font-semibold sm:text-xl ${totalOverdraftMinor > 0 ? "text-gider" : ""}`}
          >
            {formatMoney(totalOverdraftMinor)}
          </p>
          <p className="muted mt-0.5 text-[11px]">
            {totalOverdraftMinor > 0 ? "faiz işliyor" : "kullanım yok"}
          </p>
        </Panel>
      </div>

      <Panel>
        <PanelHeader
          title="Hesaplar"
          subtitle="Banka hesapları, nakit ve birikimler"
          action={
            <span onClick={() => setCreating(true)}>
              <AddButton label="Hesap" />
            </span>
          }
        />

        {active.length === 0 ? (
          <EmptyState
            icon={<Wallet size={28} />}
            title="Henüz hesap yok"
            description="Vadesiz hesabınızla başlayın. Ek hesap (KMH) limitiniz varsa onu da girin — nakit akışı projeksiyonu bunu hesaba katar."
            action={
              <Button variant="primary" onClick={() => setCreating(true)}>
                İlk hesabı ekle
              </Button>
            }
          />
        ) : (
          <ul>
            {active.map((account) => (
              <li key={account.id} className="border-b px-4 py-3 last:border-b-0 sm:px-5">
                <div className="flex items-start gap-3">
                  <span
                    className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white"
                    style={{ backgroundColor: account.color }}
                    aria-hidden
                  >
                    <Landmark size={16} />
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="truncate text-sm font-medium">{account.name}</p>
                      <Badge tone="nötr">{TYPE_LABEL[account.type] ?? account.type}</Badge>
                      {account.currency !== "TRY" ? (
                        <Badge tone="brand">{account.currency}</Badge>
                      ) : null}
                      {account.excludeFromNetWorth ? (
                        <Badge tone="nötr">net değere dahil değil</Badge>
                      ) : null}
                    </div>

                    <p className="faint mt-0.5 truncate text-[11px]">
                      {account.institutionName ?? "Kurum belirtilmemiş"}
                      {account.iban ? ` · ${account.iban.slice(-8)}` : ""}
                      {account.lastSnapshotDate
                        ? ` · son mutabakat ${formatDateTR(account.lastSnapshotDate)}`
                        : ""}
                    </p>

                    {account.overdraftLimitMinor > 0 ? (
                      <div className="mt-2">
                        <div className="mb-1 flex items-center justify-between gap-2">
                          <span className="faint text-[10px]">
                            Ek hesap {formatMoney(account.overdraftUsedMinor, account.currency)} /{" "}
                            {formatMoney(account.overdraftLimitMinor, account.currency)}
                            {account.overdraftRateBps > 0
                              ? ` · yıllık ${formatBps(account.overdraftRateBps)}`
                              : ""}
                          </span>
                        </div>
                        <ProgressBar
                          ratio={
                            account.overdraftLimitMinor > 0
                              ? account.overdraftUsedMinor / account.overdraftLimitMinor
                              : 0
                          }
                          tone="gider"
                        />
                      </div>
                    ) : null}
                  </div>

                  <div className="shrink-0 text-right">
                    <Money
                      minor={account.balanceMinor}
                      currency={account.currency}
                      tone={account.balanceMinor < 0 ? "gider" : "nötr"}
                      className={`block text-sm font-semibold ${account.balanceMinor < 0 ? "text-gider" : ""}`}
                    />
                    {account.currency !== "TRY" ? (
                      <span className="faint text-[10px]">
                        ≈ {formatMoney(account.balanceTRYMinor)}
                      </span>
                    ) : account.overdraftAvailableMinor > 0 ? (
                      <span className="faint text-[10px]">
                        +{formatMoney(account.overdraftAvailableMinor, account.currency, { compact: true })} ek
                      </span>
                    ) : null}
                  </div>
                </div>

                <div className="mt-2 flex justify-end gap-1">
                  <Button size="sm" variant="ghost" onClick={() => setReconciling(account)}>
                    <Scale size={13} />
                    Bakiye düzelt
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(account)}>
                    <Pencil size={13} />
                    Düzenle
                  </Button>
                  <DeleteButton action={deleteAccountAction} id={account.id} iconOnly />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {archived.length > 0 ? (
        <Panel>
          <PanelHeader title="Arşivlenmiş hesaplar" subtitle={`${archived.length} hesap`} />
          <ul>
            {archived.map((account) => (
              <li
                key={account.id}
                className="flex items-center gap-3 border-b px-4 py-2.5 last:border-b-0 sm:px-5"
              >
                <span className="muted min-w-0 flex-1 truncate text-sm">{account.name}</span>
                <Money
                  minor={account.balanceMinor}
                  currency={account.currency}
                  className="muted text-xs"
                />
                <Button size="sm" variant="ghost" onClick={() => setEditing(account)}>
                  <Pencil size={13} />
                </Button>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      {/* Yeni hesap */}
      <FormDialog
        title="Yeni hesap"
        description="Sisteme giriş anındaki bakiyeyi açılış bakiyesi olarak girin."
        action={saveAccountAction}
        open={creating}
        onOpenChange={setCreating}
      >
        <AccountFields institutions={institutions} />
      </FormDialog>

      {/* Düzenleme */}
      {editing ? (
        <FormDialog
          key={editing.id}
          title={editing.name}
          description="Hesap bilgilerini güncelleyin."
          action={saveAccountAction}
          open
          onOpenChange={(open) => !open && setEditing(null)}
        >
          <input type="hidden" name="id" value={editing.id} />
          <AccountFields institutions={institutions} account={editing} />
        </FormDialog>
      ) : null}

      {/* Bakiye mutabakatı */}
      {reconciling ? (
        <FormDialog
          key={`snap-${reconciling.id}`}
          title={`${reconciling.name} — bakiye düzeltme`}
          description="Bankadaki gerçek bakiyeyi girin. Bu tarihten sonraki hareketler bunun üzerine işlenir."
          action={saveBalanceSnapshotAction}
          submitLabel="Bakiyeyi ayarla"
          open
          onOpenChange={(open) => !open && setReconciling(null)}
        >
          <input type="hidden" name="accountId" value={reconciling.id} />
          <div className="surface-2 rounded-lg px-3 py-2.5">
            <p className="faint text-[11px]">Sistemdeki güncel bakiye</p>
            <p className="tabular text-base font-semibold">
              {formatMoney(reconciling.balanceMinor, reconciling.currency)}
            </p>
          </div>
          <MoneyField
            name="balance"
            label="Gerçek bakiye"
            required
            defaultMinor={reconciling.balanceMinor}
            hint="Eksi bakiye için başına - koyun (ek hesap kullanımı)."
          />
          <DateField name="date" label="Tarih" defaultValue={todayISO()} required />
          <TextField name="note" label="Not" placeholder="isteğe bağlı" />
        </FormDialog>
      ) : null}
    </div>
  );
}

function AccountFields({
  institutions,
  account,
}: {
  institutions: Option[];
  account?: AccountView;
}) {
  return (
    <>
      <TextField
        name="name"
        label="Hesap adı"
        required
        defaultValue={account?.name}
        placeholder="Örn. Garanti Vadesiz"
      />

      <FieldRow>
        <SelectField
          name="institutionId"
          label="Banka"
          options={institutions}
          placeholder="Seçiniz"
          defaultValue={account?.institutionId}
        />
        <SelectField
          name="type"
          label="Hesap türü"
          options={ACCOUNT_TYPES}
          defaultValue={account?.type ?? "vadesiz"}
        />
      </FieldRow>

      <FieldRow>
        <CurrencyField defaultValue={account?.currency ?? "TRY"} />
        <MoneyField
          name="openingBalance"
          label="Açılış bakiyesi"
          defaultMinor={account?.openingBalanceMinor}
        />
      </FieldRow>

      <DateField
        name="openingDate"
        label="Açılış tarihi"
        defaultValue={account?.openingDate ?? todayISO()}
        required
        hint="Açılış bakiyesinin geçerli olduğu tarih."
      />

      <TextField
        name="iban"
        label="IBAN"
        defaultValue={account?.iban}
        placeholder="TR00 0000 0000 0000 0000 0000 00"
      />

      <div className="border-t pt-3.5">
        <p className="mb-3 text-xs font-semibold">Ek hesap (KMH)</p>
        <FieldRow>
          <MoneyField
            name="overdraftLimit"
            label="Ek hesap limiti"
            defaultMinor={account?.overdraftLimitMinor}
          />
          <NumberField
            name="overdraftRate"
            label="Yıllık faiz"
            suffix="%"
            step="0.01"
            defaultValue={
              account?.overdraftRateBps ? account.overdraftRateBps / 100 : ""
            }
          />
        </FieldRow>
      </div>

      <div className="border-t pt-3.5">
        <p className="mb-3 text-xs font-semibold">Vadeli hesap (isteğe bağlı)</p>
        <FieldRow>
          <DateField
            name="maturityDate"
            label="Vade bitişi"
            defaultValue={account?.maturityDate}
          />
          <NumberField
            name="interestRate"
            label="Faiz oranı"
            suffix="%"
            step="0.01"
            defaultValue={account?.interestRateBps ? account.interestRateBps / 100 : ""}
          />
        </FieldRow>
      </div>

      <div className="border-t pt-3.5">
        <ColorField defaultValue={account?.color ?? "#0ea5e9"} />
      </div>

      <TextField name="notes" label="Not" defaultValue={account?.notes} />

      <div className="space-y-1 border-t pt-3.5">
        <CheckboxField
          name="excludeFromNetWorth"
          label="Net değer hesabına dahil etme"
          hint="Ortak hesap gibi size ait olmayan bakiyeler için."
          defaultChecked={account?.excludeFromNetWorth}
        />
        <CheckboxField
          name="isArchived"
          label="Arşivle"
          hint="Kapanmış hesaplar listede alta düşer, hareketleri korunur."
          defaultChecked={account ? !account.isActive : false}
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
