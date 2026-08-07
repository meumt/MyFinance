"use client";

import { CalendarDays, ListChecks, Pencil } from "lucide-react";
import { useState } from "react";

import { deletePlanAction, savePlanAction } from "@/app/actions/installments";
import { InstallmentLoadChart } from "@/components/charts";
import { Money } from "@/components/display";
import {
  CurrencyField,
  FieldRow,
  SelectField,
  TextField,
  type Option,
} from "@/components/fields";
import { AddButton, DeleteButton, FormDialog } from "@/components/form-dialog";
import {
  Badge,
  Button,
  EmptyState,
  Field,
  Input,
  Panel,
  PanelHeader,
  ProgressBar,
  Select,
  cn,
} from "@/components/ui";
import { formatDateTR, formatMonthTR } from "@/lib/dates";
import {
  previewSchedule,
  STATE_SHORT,
  type InstallmentSchedule,
  type InstallmentState,
} from "@/lib/installments";
import { formatMoney, parseMoneyToMinor } from "@/lib/money";

export interface CardOption extends Option {
  statementDay: number;
  dueDay: number;
}

export interface PlanView {
  id: number;
  cardId: number;
  cardName: string;
  cardColor: string;
  statementDay: number | null;
  dueDay: number | null;
  description: string;
  purchaseDate: string;
  totalAmountMinor: number;
  currency: string;
  installmentCount: number;
  categoryId: number | null;
  merchantName: string | null;
  notes: string | null;
  remainingMinor: number;
  settledCount: number;
  nextDueDate: string | null;
  nextAmountMinor: number;
  lastDueDate: string | null;
  schedule: InstallmentSchedule[];
}

const STATE_TONE: Record<InstallmentState, "nötr" | "gelir" | "gider" | "uyari" | "brand"> = {
  gecmis: "nötr",
  odendi: "gelir",
  bekliyor: "gider",
  bu_donemde: "brand",
  gelecek: "nötr",
};

export function InstallmentsClient({
  plans,
  cards,
  categories,
  loadByMonth,
  totals,
}: {
  plans: PlanView[];
  cards: CardOption[];
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

  const active = plans.filter((p) => p.remainingMinor > 0);
  const finished = plans.filter((p) => p.remainingMinor <= 0);
  const lastDue = active.reduce<string | null>(
    (acc, p) => (p.lastDueDate && (!acc || p.lastDueDate > acc) ? p.lastDueDate : acc),
    null,
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2.5 sm:gap-3">
        <Panel className="p-3 sm:p-4">
          <p className="faint text-[11px] font-medium tracking-wide uppercase">
            Kalan taksit borcu
          </p>
          <p className="para tabular mt-1 text-base font-semibold sm:text-xl">
            {formatMoney(totals.remainingMinor, "TRY", { compact: true })}
          </p>
        </Panel>
        <Panel className="p-3 sm:p-4">
          <p className="faint text-[11px] font-medium tracking-wide uppercase">
            Bu ayki ekstrelerde
          </p>
          <p className="para tabular mt-1 text-base font-semibold sm:text-xl">
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
            subtitle="Hangi ay hangi ekstreye ne kadar taksit düşüyor"
          />
          <div className="p-3 sm:p-4">
            <InstallmentLoadChart data={loadByMonth} />
          </div>
        </Panel>
      ) : null}

      <Panel>
        <PanelHeader
          title="Taksitli alışverişler"
          subtitle="Taksitler ekstre tarihlerine göre kendiliğinden ilerler"
          action={
            <span onClick={() => setCreating(true)}>
              <AddButton label="Taksit" />
            </span>
          }
        />

        {active.length === 0 ? (
          <EmptyState
            icon={<ListChecks size={28} />}
            title="Devam eden taksitli alışveriş yok"
            description="Alışverişi girin — hangi taksitin hangi ekstreye düşeceğini sistem hesaplar, siz bir şey işaretlemezsiniz."
            action={
              <Button variant="primary" onClick={() => setCreating(true)}>
                Taksitli alışveriş ekle
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
                      <p className="para faint mt-0.5 truncate text-[11px]">
                        {plan.cardName} · {formatDateTR(plan.purchaseDate)} ·{" "}
                        {plan.installmentCount} taksit ·{" "}
                        {formatMoney(plan.totalAmountMinor, plan.currency)}
                      </p>
                      {plan.nextDueDate ? (
                        <p className="muted para mt-0.5 text-[11px]">
                          Sıradaki taksit{" "}
                          <span className="tabular font-medium">
                            {formatMoney(plan.nextAmountMinor, plan.currency)}
                          </span>{" "}
                          · {formatDateTR(plan.nextDueDate)} tarihinde ödenecek
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
                        {plan.settledCount}/{plan.installmentCount} tamamlandı
                      </span>
                    </div>
                  </div>

                  <div className="mt-2.5">
                    <ProgressBar
                      ratio={plan.settledCount / plan.installmentCount}
                      tone="gelir"
                    />
                  </div>

                  <div className="mt-2 flex justify-end gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setExpanded(expanded === plan.id ? null : plan.id)}
                    >
                      <CalendarDays size={13} />
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
                  <div className="surface-2 table-scroll border-t">
                    <table className="w-full min-w-[34rem] text-xs">
                      <thead>
                        <tr className="faint border-b text-left">
                          <th className="px-4 py-2 font-medium sm:px-5">Taksit</th>
                          <th className="px-2 py-2 text-right font-medium">Tutar</th>
                          <th className="px-2 py-2 font-medium">Karta işlendiği gün</th>
                          <th className="px-2 py-2 font-medium">Hangi ekstrede</th>
                          <th className="px-2 py-2 font-medium">Ne zaman ödenir</th>
                          <th className="px-4 py-2 font-medium sm:px-5">Durum</th>
                        </tr>
                      </thead>
                      <tbody className="tabular">
                        {plan.schedule.map((s) => (
                          <tr
                            key={s.id}
                            className={cn(
                              "border-b last:border-b-0",
                              s.state === "bu_donemde" && "bg-brand-500/5",
                              !s.countsAsDebt && "opacity-55",
                            )}
                          >
                            <td className="px-4 py-2 sm:px-5">
                              {s.seq}/{plan.installmentCount}
                            </td>
                            <td className="px-2 py-2 text-right font-medium">
                              {formatMoney(s.amountMinor, plan.currency, {
                                showSymbol: false,
                              })}
                            </td>
                            <td className="px-2 py-2">{formatDateTR(s.postedDate)}</td>
                            <td className="muted px-2 py-2">
                              {formatDateTR(s.statementDate)} kesimi
                            </td>
                            <td className="px-2 py-2">{formatDateTR(s.dueDate)}</td>
                            <td className="px-4 py-2 sm:px-5">
                              <Badge tone={STATE_TONE[s.state]}>
                                {STATE_SHORT[s.state]}
                              </Badge>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <p className="faint px-4 py-2.5 text-[11px] leading-relaxed sm:px-5">
                      Taksitler alışveriş gününün her ayki karşılığında karta
                      işleniyor; o işlem hangi ekstre dönemine denk gelirse orada
                      faturalanıyor (kesim {plan.statementDay}, ödeme {plan.dueDay}).
                      Elle işaretlemeniz gerekmez — ekstre ödendiğinde içindeki
                      taksitler de kapanmış sayılır.
                    </p>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {finished.length > 0 ? (
        <Panel>
          <PanelHeader title="Biten taksitler" subtitle={`${finished.length} alışveriş`} />
          <ul>
            {finished.map((plan) => (
              <li
                key={plan.id}
                className="flex items-center gap-3 border-b px-4 py-2.5 last:border-b-0 sm:px-5"
              >
                <div className="min-w-0 flex-1">
                  <p className="muted truncate text-sm">{plan.description}</p>
                  <p className="para faint text-[11px]">
                    {plan.cardName} · {plan.installmentCount} taksit ·{" "}
                    {formatMoney(plan.totalAmountMinor, plan.currency)}
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
        description="Alışveriş tarihini girin; hangi taksitin hangi ekstreye düşeceğini sistem hesaplar."
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
          description="Takvim yeniden hesaplanacak."
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

/**
 * Plan formu. Alışveriş tarihi, tutar ve taksit sayısı girildikçe takvim
 * canlı önizlenir — kartın kesim günü yanlışsa kullanıcı burada fark eder.
 */
function PlanFields({
  cards,
  categories,
  plan,
}: {
  cards: CardOption[];
  categories: Option[];
  plan?: PlanView;
}) {
  const [cardId, setCardId] = useState(String(plan?.cardId ?? cards[0]?.value ?? ""));
  const [amount, setAmount] = useState(
    plan ? (plan.totalAmountMinor / 100).toFixed(2).replace(".", ",") : "",
  );
  const [count, setCount] = useState(String(plan?.installmentCount ?? ""));
  const [purchaseDate, setPurchaseDate] = useState(plan?.purchaseDate ?? todayISO());

  const card = cards.find((c) => String(c.value) === cardId);
  const totalMinor = parseMoneyToMinor(amount) ?? 0;
  const n = Number(count);

  const preview =
    card && totalMinor > 0 && Number.isInteger(n) && n >= 1 && n <= 60
      ? previewSchedule({
          totalAmountMinor: totalMinor,
          installmentCount: n,
          purchaseDate,
          cycle: { statementDay: card.statementDay, dueDay: card.dueDay },
        })
      : [];

  return (
    <>
      <TextField
        name="description"
        label="Ne aldınız?"
        required
        defaultValue={plan?.description}
        placeholder="Örn. Sandalye"
      />

      {/* Bu alanlar kontrollü: yazdıkça aşağıdaki takvim önizlemesi güncellenir. */}
      <Field
        label="Kart"
        required
        hint={
          card
            ? `Hesap kesim ${card.statementDay}. gün, son ödeme ${card.dueDay}. gün`
            : undefined
        }
      >
        <Select name="cardId" value={cardId} onChange={(e) => setCardId(e.target.value)}>
          <option value="">Seçiniz</option>
          {cards.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </Select>
      </Field>

      <FieldRow>
        <Field label="Toplam tutar" required>
          <Input
            name="totalAmount"
            inputMode="decimal"
            className="tabular"
            placeholder="0,00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </Field>
        <Field label="Taksit sayısı" required>
          <Input
            name="installmentCount"
            inputMode="numeric"
            className="tabular"
            placeholder="6"
            value={count}
            onChange={(e) => setCount(e.target.value)}
          />
        </Field>
      </FieldRow>

      <Field
        label="Alışveriş tarihi"
        required
        hint="Kesim gününden sonraysa ilk taksit bir sonraki ekstreye düşer."
      >
        <Input
          type="date"
          name="purchaseDate"
          value={purchaseDate}
          onChange={(e) => setPurchaseDate(e.target.value)}
        />
      </Field>

      <div className="surface-2 rounded-lg p-3">
        <p className="mb-2 text-xs font-semibold">Takvim önizlemesi</p>
        {preview.length === 0 ? (
          <p className="faint text-[11px] leading-relaxed">
            Kart, tutar ve taksit sayısını girin; hangi taksitin hangi ekstreye
            düşeceğini burada göreceksiniz.
          </p>
        ) : (
          <>
            <ul className="space-y-1">
              {preview.slice(0, 6).map((p) => (
                <li
                  key={p.seq}
                  className="flex items-baseline justify-between gap-2 text-[11px]"
                >
                  <span className="muted">
                    {p.seq}. taksit · {formatDateTR(p.postedDate)} işlenir
                  </span>
                  <span className="tabular shrink-0 font-medium">
                    {formatDateTR(p.dueDate)} · {formatMoney(p.amountMinor)}
                  </span>
                </li>
              ))}
            </ul>
            {preview.length > 6 ? (
              <p className="faint mt-1.5 text-[11px]">
                … son taksit {formatDateTR(preview[preview.length - 1].dueDate)}{" "}
                tarihinde ödenecek
              </p>
            ) : null}
            <p className="faint mt-2 text-[11px] leading-relaxed">
              Doğru görünmüyorsa kartın hesap kesim / son ödeme günü yanlış
              girilmiş olabilir.
            </p>
          </>
        )}
      </div>

      <TextField
        name="merchantName"
        label="İşyeri"
        defaultValue={plan?.merchantName}
        placeholder="Örn. HepsiBurada"
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
