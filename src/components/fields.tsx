"use client";

import { CURRENCIES, CURRENCY_CODES, minorToInputString } from "@/lib/money";
import { Field, Input, Select } from "./ui";

/**
 * Formlarda tekrar eden alanlar. Para ve tarih girişleri her yerde aynı
 * davranmalı: para alanı ondalık klavye açar, tarih alanı yerel biçim gösterir.
 */

export interface Option {
  value: string | number;
  label: string;
  group?: string;
}

export function MoneyField({
  name,
  label,
  defaultMinor,
  required,
  hint,
  placeholder = "0,00",
}: {
  name: string;
  label: string;
  defaultMinor?: number | null;
  required?: boolean;
  hint?: string;
  placeholder?: string;
}) {
  return (
    <Field label={label} required={required} hint={hint}>
      <Input
        name={name}
        // inputMode="decimal" mobilde ondalık klavyeyi açar; type=text kalır
        // çünkü type=number Türkçe virgülü reddediyor.
        inputMode="decimal"
        placeholder={placeholder}
        defaultValue={
          defaultMinor != null && defaultMinor !== 0
            ? minorToInputString(defaultMinor)
            : ""
        }
        className="tabular"
      />
    </Field>
  );
}

export function DateField({
  name,
  label,
  defaultValue,
  required,
  hint,
}: {
  name: string;
  label: string;
  defaultValue?: string | null;
  required?: boolean;
  hint?: string;
}) {
  return (
    <Field label={label} required={required} hint={hint}>
      <Input type="date" name={name} defaultValue={defaultValue ?? ""} />
    </Field>
  );
}

export function SelectField({
  name,
  label,
  options,
  defaultValue,
  placeholder,
  required,
  hint,
}: {
  name: string;
  label: string;
  options: Option[];
  defaultValue?: string | number | null;
  placeholder?: string;
  required?: boolean;
  hint?: string;
}) {
  const groups = [...new Set(options.map((o) => o.group).filter(Boolean))] as string[];

  return (
    <Field label={label} required={required} hint={hint}>
      <Select name={name} defaultValue={defaultValue ?? ""}>
        {placeholder ? <option value="">{placeholder}</option> : null}
        {groups.length > 0
          ? groups.map((group) => (
              <optgroup key={group} label={group}>
                {options
                  .filter((o) => o.group === group)
                  .map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
              </optgroup>
            ))
          : options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
      </Select>
    </Field>
  );
}

export function CurrencyField({
  defaultValue = "TRY",
  name = "currency",
  label = "Para birimi",
}: {
  defaultValue?: string;
  name?: string;
  label?: string;
}) {
  return (
    <SelectField
      name={name}
      label={label}
      defaultValue={defaultValue}
      options={CURRENCY_CODES.map((code) => ({
        value: code,
        label: `${CURRENCIES[code].label} (${CURRENCIES[code].symbol})`,
      }))}
    />
  );
}

export function TextField({
  name,
  label,
  defaultValue,
  placeholder,
  required,
  hint,
  type = "text",
  inputMode,
}: {
  name: string;
  label: string;
  defaultValue?: string | null;
  placeholder?: string;
  required?: boolean;
  hint?: string;
  type?: string;
  inputMode?: "text" | "numeric" | "decimal" | "email" | "url";
}) {
  return (
    <Field label={label} required={required} hint={hint}>
      <Input
        type={type}
        name={name}
        inputMode={inputMode}
        defaultValue={defaultValue ?? ""}
        placeholder={placeholder}
      />
    </Field>
  );
}

export function NumberField({
  name,
  label,
  defaultValue,
  min,
  max,
  step = "1",
  suffix,
  required,
  hint,
  placeholder,
}: {
  name: string;
  label: string;
  defaultValue?: number | string | null;
  min?: number;
  max?: number;
  step?: string;
  suffix?: string;
  required?: boolean;
  hint?: string;
  placeholder?: string;
}) {
  return (
    <Field label={label} required={required} hint={hint}>
      <div className="relative">
        <Input
          name={name}
          inputMode="decimal"
          min={min}
          max={max}
          step={step}
          placeholder={placeholder}
          defaultValue={defaultValue ?? ""}
          className={suffix ? "tabular pr-10" : "tabular"}
        />
        {suffix ? (
          <span className="faint pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs">
            {suffix}
          </span>
        ) : null}
      </div>
    </Field>
  );
}

export function CheckboxField({
  name,
  label,
  hint,
  defaultChecked,
}: {
  name: string;
  label: string;
  hint?: string;
  defaultChecked?: boolean;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 py-1">
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        className="accent-brand-600 mt-0.5 h-4.5 w-4.5 shrink-0 rounded"
        style={{ width: "1.125rem", height: "1.125rem" }}
      />
      <span className="min-w-0">
        <span className="block text-xs font-medium">{label}</span>
        {hint ? <span className="faint block text-[11px] leading-relaxed">{hint}</span> : null}
      </span>
    </label>
  );
}

export function ColorField({
  name = "color",
  label = "Renk",
  defaultValue = "#0ea5e9",
}: {
  name?: string;
  label?: string;
  defaultValue?: string;
}) {
  const swatches = [
    "#ef4444", "#f97316", "#f59e0b", "#10b981", "#14b8a6",
    "#0ea5e9", "#6366f1", "#8b5cf6", "#a855f7", "#ec4899",
    "#64748b", "#0f172a",
  ];

  return (
    <Field label={label}>
      <div className="flex flex-wrap gap-1.5">
        {swatches.map((color) => (
          <label key={color} className="cursor-pointer">
            <input
              type="radio"
              name={name}
              value={color}
              defaultChecked={color === defaultValue}
              className="peer sr-only"
            />
            <span
              className="peer-checked:ring-brand-500 block h-8 w-8 rounded-lg ring-2 ring-transparent ring-offset-2 ring-offset-[var(--surface)] transition-all peer-checked:scale-110"
              style={{ backgroundColor: color }}
            />
          </label>
        ))}
      </div>
    </Field>
  );
}

/** Form içinde iki alanı yan yana koymak için. */
export function FieldRow({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-3">{children}</div>;
}
