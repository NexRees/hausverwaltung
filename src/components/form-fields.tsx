"use client";

import type * as React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { SharedCheckboxes, SharedOptionElements } from "@/components/shared-options";
import { FieldErrorText, useFieldError } from "@/components/field-errors";

// nexrees: every field shows its server-side validation message (via CrudDialog) and is marked
// aria-invalid / aria-describedby; TextField passes through input constraints (min, max,
// inputMode, autoComplete, placeholder, pattern) so people, browsers and agents see the rules.
type InputExtras = Pick<
  React.InputHTMLAttributes<HTMLInputElement>,
  "min" | "max" | "minLength" | "maxLength" | "inputMode" | "autoComplete" | "placeholder" | "pattern"
>;

export function TextField({
  name,
  label,
  defaultValue,
  type = "text",
  required = true,
  step,
  hint,
  ...extras
}: {
  name: string;
  label: string;
  defaultValue?: string | number;
  type?: string;
  required?: boolean;
  step?: string;
  /** nexrees: short help text under the field (format, unit), linked via aria-describedby */
  hint?: string;
} & InputExtras) {
  const hintId = hint ? `${name}-hint` : undefined;
  const { message, inputProps } = useFieldError(name, hintId);
  return (
    <div className="space-y-2">
      <Label htmlFor={name}>{label}</Label>
      <Input
        id={name}
        name={name}
        type={type}
        step={step}
        defaultValue={defaultValue}
        required={required}
        {...extras}
        {...inputProps}
      />
      {hint && (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      <FieldErrorText name={name} message={message} />
    </div>
  );
}

export function CustomFields({
  defs,
  values,
}: {
  defs: { key: string; label: string }[];
  values?: Record<string, string>;
}) {
  return (
    <>
      {defs.map((d) => (
        <TextField
          key={d.key}
          name={`cf_${d.key}`}
          label={d.label}
          required={false}
          defaultValue={values?.[d.key]}
        />
      ))}
    </>
  );
}

export function TextAreaField({
  name,
  label,
  defaultValue,
  required = false,
  rows = 4,
}: {
  name: string;
  label: string;
  defaultValue?: string;
  required?: boolean;
  rows?: number;
}) {
  const { message, inputProps } = useFieldError(name);
  return (
    <div className="space-y-2">
      <Label htmlFor={name}>{label}</Label>
      <textarea
        id={name}
        name={name}
        rows={rows}
        defaultValue={defaultValue}
        required={required}
        {...inputProps}
        className={cn(
          "flex w-full rounded-lg border border-input bg-transparent px-3 py-2 text-base shadow-xs md:text-sm",
          "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 outline-none",
          "aria-invalid:border-destructive dark:bg-input/30",
        )}
      />
      <FieldErrorText name={name} message={message} />
    </div>
  );
}

export function MultiSelectField({
  name,
  label,
  options,
  defaultValues = [],
}: {
  name: string;
  label: string;
  /** nexrees: the options, or the name of a list from <SharedOptionsProvider>. */
  options: { value: string; label: string }[] | string;
  defaultValues?: string[];
}) {
  const { message } = useFieldError(name);
  // nexrees: a named group (fieldset + legend), so each checkbox is announced with its question
  return (
    <fieldset className="min-w-0 space-y-2" aria-describedby={message ? `${name}-error` : undefined}>
      <legend className="text-sm leading-none font-medium select-none">{label}</legend>
      <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-input p-2 dark:bg-input/30">
        {typeof options === "string" ? (
          <SharedCheckboxes list={options} name={name} defaultValues={defaultValues} />
        ) : (
          <SharedCheckboxes options={options} name={name} defaultValues={defaultValues} />
        )}
      </div>
      <FieldErrorText name={name} message={message} />
    </fieldset>
  );
}

export function SelectField({
  name,
  label,
  options,
  leading = [],
  defaultValue,
}: {
  name: string;
  label: string;
  /** nexrees: the options, or the name of a list from <SharedOptionsProvider>. */
  options: { value: string; label: string }[] | string;
  /** Options shown before `options`, e.g. "none". */
  leading?: { value: string; label: string }[];
  defaultValue?: string;
}) {
  const { message, inputProps } = useFieldError(name);
  return (
    <div className="space-y-2">
      <Label htmlFor={name}>{label}</Label>
      <select
        id={name}
        name={name}
        defaultValue={defaultValue}
        {...inputProps}
        className={cn(
          "flex h-9 w-full rounded-lg border border-input bg-transparent px-3 py-1 text-base shadow-xs md:text-sm",
          "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 outline-none",
          "aria-invalid:border-destructive dark:bg-input/30",
        )}
      >
        {leading.map((o) => (
          <option key={`lead-${o.value}`} value={o.value}>
            {o.label}
          </option>
        ))}
        {typeof options === "string" ? (
          <SharedOptionElements list={options} />
        ) : (
          options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))
        )}
      </select>
      <FieldErrorText name={name} message={message} />
    </div>
  );
}
