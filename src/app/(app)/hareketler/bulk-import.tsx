"use client";

import { ClipboardPaste, Loader2, X } from "lucide-react";
import { useActionState, useMemo, useState } from "react";

import type { ActionState } from "@/app/actions/_helpers";
import { bulkImportAction } from "@/app/actions/transactions";
import type { Option } from "@/components/fields";
import { Badge, Button, Field, Panel, Select, Textarea, cn } from "@/components/ui";
import { formatDateShortTR } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { parseBulkStatement, rowSignature } from "@/lib/parser";

/**
 * Toplu içe aktarma. Banka ekstresi ya da hesap hareketleri yapıştırılır,
 * satırlar ayrıştırılıp onay ekranında gösterilir. İlk veri yüklemesinde
 * yüzlerce hareketi tek tek girmek yerine bu ekran kullanılır.
 */

interface DraftRow {
  key: string;
  date: string;
  description: string;
  amountMinor: number;
  kind: "gider" | "gelir";
  categoryId: number | null;
  skip: boolean;
  confident: boolean;
}

export function BulkImport({
  sources,
  categories,
  existingSignatures,
}: {
  sources: Option[];
  categories: Option[];
  /** Zaten kayıtlı hareketlerin imzaları — tekrar girişi engeller. */
  existingSignatures: string[];
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [rows, setRows] = useState<DraftRow[] | null>(null);
  const [source, setSource] = useState(String(sources[0]?.value ?? ""));
  const [expenseIsNegative, setExpenseIsNegative] = useState(true);

  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    bulkImportAction,
    {},
  );

  const existing = useMemo(() => new Set(existingSignatures), [existingSignatures]);

  function parse() {
    const parsed = parseBulkStatement(text, { expenseIsNegative });
    setRows(
      parsed.map((r, i) => {
        const signature = rowSignature(r);
        const duplicate = existing.has(signature);
        return {
          key: `${signature}-${i}`,
          date: r.date,
          description: r.description,
          amountMinor: r.amountMinor,
          kind: r.kind,
          categoryId: null,
          // Zaten kayıtlı görünen satırlar varsayılan olarak atlanır.
          skip: duplicate,
          confident: r.confident && !duplicate,
        };
      }),
    );
  }

  const accepted = rows?.filter((r) => !r.skip) ?? [];
  const totalExpense = accepted
    .filter((r) => r.kind === "gider")
    .reduce((s, r) => s + r.amountMinor, 0);
  const totalIncome = accepted
    .filter((r) => r.kind === "gelir")
    .reduce((s, r) => s + r.amountMinor, 0);

  function update(key: string, patch: Partial<DraftRow>) {
    setRows((prev) => prev?.map((r) => (r.key === key ? { ...r, ...patch } : r)) ?? null);
  }

  if (!open) {
    return (
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <ClipboardPaste size={14} />
        Toplu ekle
      </Button>
    );
  }

  return (
    <>
      <div
        className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px]"
        onClick={() => setOpen(false)}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Toplu hareket ekleme"
        className="surface animate-in fixed inset-x-0 bottom-0 z-50 flex max-h-[94dvh] flex-col rounded-t-2xl border-t sm:inset-6 sm:bottom-6 sm:mx-auto sm:max-w-4xl sm:rounded-2xl sm:border"
      >
        <div className="flex items-center justify-between gap-3 border-b px-4 py-3 sm:px-5">
          <div>
            <h2 className="text-sm font-semibold">Toplu hareket ekle</h2>
            <p className="muted mt-0.5 text-xs">
              Banka ekstresini kopyalayıp yapıştırın; satırlar otomatik ayrıştırılır.
            </p>
          </div>
          <button
            onClick={() => setOpen(false)}
            className="focus-ring hover:bg-[var(--surface-2)] flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
            aria-label="Kapat"
          >
            <X size={16} />
          </button>
        </div>

        <div className="thin-scroll min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
          {rows === null ? (
            <div className="space-y-3.5">
              <Field
                label="Ekstre metni"
                hint="Her satırda tarih, açıklama ve tutar olmalı. Sütunlar boşluk ya da sekmeyle ayrılabilir."
              >
                <Textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  rows={12}
                  className="min-h-56 font-mono text-xs"
                  placeholder={"05.08.2026\tMIGROS TICARET A.S.\t-1.234,56\n04.08.2026\tNETFLIX.COM\t-229,99\n02.08.2026\tMAAS ODEMESI\t+45.000,00"}
                />
              </Field>

              <label className="flex cursor-pointer items-start gap-2.5">
                <input
                  type="checkbox"
                  checked={expenseIsNegative}
                  onChange={(e) => setExpenseIsNegative(e.target.checked)}
                  className="accent-brand-600 mt-0.5"
                  style={{ width: "1.125rem", height: "1.125rem" }}
                />
                <span>
                  <span className="block text-xs font-medium">
                    Giderler eksi işaretli
                  </span>
                  <span className="faint block text-[11px]">
                    Çoğu banka gideri &quot;-1.234,56&quot; biçiminde gösterir. Ekstrenizde
                    işaret yoksa bu kutuyu kaldırın; tüm satırlar gider sayılır.
                  </span>
                </span>
              </label>

              <Button
                variant="primary"
                size="lg"
                onClick={parse}
                disabled={!text.trim()}
                className="w-full"
              >
                Satırları ayrıştır
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="surface-2 flex flex-wrap items-center gap-x-5 gap-y-1.5 rounded-lg px-3 py-2.5 text-xs">
                <span>
                  <strong>{accepted.length}</strong> satır kaydedilecek
                </span>
                {rows.length - accepted.length > 0 ? (
                  <span className="muted">
                    {rows.length - accepted.length} atlanacak
                  </span>
                ) : null}
                <span className="text-gider">
                  Gider {formatMoney(totalExpense)}
                </span>
                {totalIncome > 0 ? (
                  <span className="text-gelir">Gelir {formatMoney(totalIncome)}</span>
                ) : null}
                <button
                  onClick={() => setRows(null)}
                  className="focus-ring text-brand-600 dark:text-brand-300 ml-auto font-medium"
                >
                  Metni düzenle
                </button>
              </div>

              {rows.length === 0 ? (
                <Panel className="p-6 text-center">
                  <p className="text-sm font-medium">Hiç satır ayrıştırılamadı</p>
                  <p className="muted mt-1 text-xs">
                    Metinde tarih ve tutar bulunan satır olmalı. Farklı bir kopyalama
                    biçimi deneyin.
                  </p>
                </Panel>
              ) : (
                <div className="table-scroll rounded-lg border">
                  <table className="w-full min-w-[38rem] text-xs">
                    <thead>
                      <tr className="faint surface-2 border-b text-left">
                        <th className="w-10 px-2 py-2"></th>
                        <th className="px-2 py-2 font-medium">Tarih</th>
                        <th className="px-2 py-2 font-medium">Açıklama</th>
                        <th className="px-2 py-2 text-right font-medium">Tutar</th>
                        <th className="px-2 py-2 font-medium">Tür</th>
                        <th className="px-2 py-2 font-medium">Kategori</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => (
                        <tr
                          key={row.key}
                          className={cn(
                            "border-b last:border-b-0",
                            row.skip && "opacity-40",
                          )}
                        >
                          <td className="px-2 py-1.5">
                            <input
                              type="checkbox"
                              checked={!row.skip}
                              onChange={(e) => update(row.key, { skip: !e.target.checked })}
                              className="accent-brand-600"
                              style={{ width: "1.05rem", height: "1.05rem" }}
                              aria-label="Bu satırı kaydet"
                            />
                          </td>
                          <td className="px-2 py-1.5">
                            <input
                              type="date"
                              value={row.date}
                              onChange={(e) => update(row.key, { date: e.target.value })}
                              className="focus-ring w-32 rounded border bg-transparent px-1.5 py-1 text-xs"
                            />
                          </td>
                          <td className="px-2 py-1.5">
                            <input
                              value={row.description}
                              onChange={(e) =>
                                update(row.key, { description: e.target.value })
                              }
                              className="focus-ring w-full min-w-32 rounded border bg-transparent px-1.5 py-1 text-xs"
                            />
                            {!row.confident && !row.skip ? (
                              <Badge tone="uyari" className="mt-1">
                                kontrol edin
                              </Badge>
                            ) : null}
                          </td>
                          <td className="tabular px-2 py-1.5 text-right whitespace-nowrap">
                            {formatMoney(row.amountMinor)}
                          </td>
                          <td className="px-2 py-1.5">
                            <select
                              value={row.kind}
                              onChange={(e) =>
                                update(row.key, {
                                  kind: e.target.value as "gider" | "gelir",
                                })
                              }
                              className="focus-ring rounded border bg-transparent px-1.5 py-1 text-xs"
                            >
                              <option value="gider">Gider</option>
                              <option value="gelir">Gelir</option>
                            </select>
                          </td>
                          <td className="px-2 py-1.5">
                            <select
                              value={row.categoryId ?? ""}
                              onChange={(e) =>
                                update(row.key, {
                                  categoryId: e.target.value ? Number(e.target.value) : null,
                                })
                              }
                              className="focus-ring w-36 rounded border bg-transparent px-1.5 py-1 text-xs"
                            >
                              <option value="">otomatik</option>
                              {categories.map((c) => (
                                <option key={c.value} value={c.value}>
                                  {c.label}
                                </option>
                              ))}
                            </select>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {state.error ? (
                <p className="bg-gider/10 text-gider rounded-lg px-3 py-2 text-xs" role="alert">
                  {state.error}
                </p>
              ) : null}
            </div>
          )}
        </div>

        {rows !== null && rows.length > 0 ? (
          <form
            action={formAction}
            className="flex flex-col gap-2 border-t px-4 py-3 sm:flex-row sm:items-end sm:px-5"
            style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 0.75rem)" }}
          >
            <input
              type="hidden"
              name="rows"
              value={JSON.stringify(
                accepted.map((r) => ({
                  date: r.date,
                  description: r.description,
                  amountMinor: r.amountMinor,
                  kind: r.kind,
                  categoryId: r.categoryId,
                  skip: false,
                })),
              )}
            />
            <input type="hidden" name="learnMerchants" value="on" />

            <label className="min-w-0 flex-1">
              <span className="mb-1.5 block text-xs font-medium">Hangi hesap/kart?</span>
              <Select
                name="source"
                value={source}
                onChange={(e) => setSource(e.target.value)}
              >
                {sources.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </Select>
            </label>

            <Button
              type="submit"
              variant="primary"
              size="lg"
              disabled={pending || accepted.length === 0}
              className="sm:w-56"
            >
              {pending ? <Loader2 size={16} className="animate-spin" /> : null}
              {accepted.length} hareketi kaydet
            </Button>
          </form>
        ) : null}
      </div>
    </>
  );
}
