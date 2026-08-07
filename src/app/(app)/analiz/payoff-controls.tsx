"use client";

import { RotateCcw } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { Button, Field, Input, Select } from "@/components/ui";
import { minorToInputString } from "@/lib/money";

/**
 * Borç kapatma simülasyonunun varsayımları. Değerler adres çubuğunda tutulur;
 * hesaplama sunucuda yapılır, böylece simülasyon tek yerde kalır.
 */
export function PayoffControls({
  incomeMinor,
  expenseMinor,
  extraMinor,
  strategy,
  /** Varsayımlar nereden geldi: geçmiş ortalaması mı, tanımlı düzenli kalemler mi. */
  source = "gecmis",
}: {
  incomeMinor: number;
  expenseMinor: number;
  extraMinor: number;
  strategy: string;
  source?: "gecmis" | "plan";
}) {
  const router = useRouter();
  const params = useSearchParams();

  const [income, setIncome] = useState(minorToInputString(incomeMinor));
  const [expense, setExpense] = useState(minorToInputString(expenseMinor));
  const [extra, setExtra] = useState(minorToInputString(extraMinor));

  function apply(overrides: Record<string, string> = {}) {
    const next = new URLSearchParams(params.toString());
    const values = { gelir: income, gider: expense, ek: extra, ...overrides };
    for (const [key, value] of Object.entries(values)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    router.push(`/analiz?${next.toString()}#borc`);
  }

  function reset() {
    const next = new URLSearchParams(params.toString());
    for (const key of ["gelir", "gider", "ek", "strateji"]) next.delete(key);
    router.push(`/analiz?${next.toString()}#borc`);
  }

  return (
    <div className="space-y-3 border-b px-4 py-3.5 sm:px-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field
          label="Aylık gelir"
          hint={
            source === "plan"
              ? "düzenli gelirlerinden"
              : "son 3 ayın ortalaması"
          }
        >
          <Input
            value={income}
            onChange={(e) => setIncome(e.target.value)}
            inputMode="decimal"
            className="tabular"
          />
        </Field>
        <Field
          label="Aylık gider"
          hint={
            source === "plan"
              ? "sabit giderler + yaşam gideri"
              : "borç ödemeleri hariç"
          }
        >
          <Input
            value={expense}
            onChange={(e) => setExpense(e.target.value)}
            inputMode="decimal"
            className="tabular"
          />
        </Field>
        <Field label="Ek ödeme" hint="her ay borca ayıracağınız fazladan tutar">
          <Input
            value={extra}
            onChange={(e) => setExtra(e.target.value)}
            inputMode="decimal"
            className="tabular"
          />
        </Field>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <Field label="Strateji" className="min-w-44 flex-1">
          <Select
            value={strategy}
            onChange={(e) => apply({ strateji: e.target.value })}
          >
            <option value="cig">Çığ — en yüksek faizli önce</option>
            <option value="kartopu">Kartopu — en küçük borç önce</option>
          </Select>
        </Field>

        <Button variant="primary" onClick={() => apply()}>
          Yeniden hesapla
        </Button>
        <Button variant="ghost" onClick={reset} title="Varsayılanlara dön">
          <RotateCcw size={14} />
        </Button>
      </div>
    </div>
  );
}
