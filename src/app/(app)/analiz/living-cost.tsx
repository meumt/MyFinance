"use client";

import { Check, Loader2 } from "lucide-react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { saveLivingCostAction } from "@/app/actions/settings";
import type { ActionState } from "@/app/actions/_helpers";
import { Button, Input } from "@/components/ui";
import { minorToInputString } from "@/lib/money";

/**
 * Aylık yaşam gideri varsayımı. Plan ekranının tek elle girilen değeri
 * olduğu için buraya, planın yanına konur: değiştirince sonucun nasıl
 * oynadığı aynı ekranda görülür.
 */
export function LivingCostForm({ valueMinor }: { valueMinor: number }) {
  const [state, formAction] = useActionState<ActionState, FormData>(
    saveLivingCostAction,
    {},
  );

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-36 flex-1">
        <Input
          name="livingCost"
          defaultValue={valueMinor > 0 ? minorToInputString(valueMinor) : ""}
          inputMode="decimal"
          placeholder="örn. 15.000"
          aria-label="Aylık yaşam gideri"
          className="tabular pr-8"
        />
        <span className="faint pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs">
          ₺
        </span>
      </div>
      <SaveButton saved={Boolean(state.success)} />
      {state.error ? (
        <p className="text-gider w-full text-[11px]">{state.error}</p>
      ) : null}
    </form>
  );
}

function SaveButton({ saved }: { saved: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" disabled={pending}>
      {pending ? (
        <Loader2 size={14} className="animate-spin" />
      ) : saved ? (
        <Check size={14} />
      ) : null}
      {pending ? "Kaydediliyor…" : "Kaydet"}
    </Button>
  );
}
